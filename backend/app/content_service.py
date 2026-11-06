import hashlib
import json
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

import httpx

from app.config import Settings, get_settings
from app.errors import ApiError
from app.security import CurrentUser

NEWS_SCHEMA = {
    "type": "object",
    "properties": {
        "outcome": {
            "type": "string",
            "enum": ["new_content", "no_new_content", "source_failed", "conditions_unconfirmed"],
        },
        "news": {
            "type": "array",
            "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {
                    "news_type": {
                        "type": "string",
                        "enum": [
                            "content",
                            "feature",
                            "limit",
                            "price",
                            "benefit",
                            "ending",
                            "other",
                        ],
                    },
                    "title": {"type": "string", "maxLength": 200},
                    "summary": {"type": "string", "maxLength": 200},
                    "source_title": {"type": "string"},
                    "source_url": {"type": "string"},
                    "source_domain": {"type": "string"},
                    "source_country_code": {"type": ["string", "null"]},
                    "source_language": {"type": ["string", "null"]},
                    "announced_on": {"type": ["string", "null"]},
                    "applies_on": {"type": ["string", "null"]},
                    "country_codes": {"type": "array", "items": {"type": "string"}},
                    "plan_scopes": {"type": "array", "items": {"type": "string"}},
                    "conditions": {"type": ["string", "null"]},
                    "impact_summary": {"type": ["string", "null"], "maxLength": 200},
                    "applicability_status": {
                        "type": "string",
                        "enum": ["confirmed", "needs_confirmation"],
                    },
                    "official_source": {"type": "boolean"},
                    "official_item_id": {"type": ["string", "null"]},
                    "is_ott_schedule": {"type": "boolean"},
                },
                "required": [
                    "news_type",
                    "title",
                    "summary",
                    "source_title",
                    "source_url",
                    "source_domain",
                    "source_country_code",
                    "source_language",
                    "announced_on",
                    "applies_on",
                    "country_codes",
                    "plan_scopes",
                    "conditions",
                    "impact_summary",
                    "applicability_status",
                    "official_source",
                    "official_item_id",
                    "is_ott_schedule",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["outcome", "news"],
    "additionalProperties": False,
}

EDITORIAL_OTT_SERVICES = (
    ("netflix", "Netflix", ["Netflix", "넷플릭스"]),
    ("tving", "티빙", ["TVING", "Tving", "티빙"]),
    ("coupangplay", "쿠팡플레이", ["Coupang Play", "쿠팡플레이", "쿠팡 플레이"]),
    ("wavve", "웨이브", ["Wavve", "웨이브"]),
    ("disneyplus", "Disney+", ["Disney+", "Disney Plus", "디즈니+", "디즈니플러스"]),
    ("watcha", "왓챠", ["Watcha", "왓챠"]),
    ("laftel", "라프텔", ["Laftel", "라프텔"]),
    ("appletvplus", "Apple TV+", ["Apple TV+", "Apple TV Plus", "애플TV+", "애플티비+"]),
    ("hbomax", "HBO Max", ["HBO Max", "Max", "에이치비오 맥스"]),
)


class ContentService:
    OTT_EDITORIAL_SERVICES = EDITORIAL_OTT_SERVICES
    SERVICE_ALIASES = {
        "netflix": ("netflix", "Netflix", ["Netflix", "넷플릭스"]),
        "넷플릭스": ("netflix", "Netflix", ["Netflix", "넷플릭스"]),
        "youtube": ("youtube", "YouTube", ["YouTube", "Youtube", "유튜브"]),
        "유튜브": ("youtube", "YouTube", ["YouTube", "Youtube", "유튜브"]),
        "midjourney": ("midjourney", "Midjourney", ["Midjourney", "미드저니"]),
        "미드저니": ("midjourney", "Midjourney", ["Midjourney", "미드저니"]),
        "chatgpt": ("chatgpt", "ChatGPT", ["ChatGPT", "챗GPT", "챗지피티"]),
        "챗지피티": ("chatgpt", "ChatGPT", ["ChatGPT", "챗GPT", "챗지피티"]),
        **{
            "".join(character.lower() for character in alias if character.isalnum()): service
            for service in EDITORIAL_OTT_SERVICES
            for alias in service[2]
        },
    }

    def __init__(self, settings: Settings):
        self.settings = settings

    def _operator(self, user: CurrentUser) -> bool:
        return str(user.id).lower() in self.settings.phase8_operator_ids

    def require_operator(self, user: CurrentUser) -> None:
        if not self._operator(user):
            raise ApiError(403, "operator_required", "운영자만 검수 기능을 사용할 수 있습니다.")

    def _headers(self, prefer: str | None = None) -> dict[str, str]:
        key = self.settings.supabase_secret_key
        if not key or not self.settings.normalized_supabase_url:
            raise ApiError(503, "content_not_configured", "정보 지원 저장소가 설정되지 않았습니다.")
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _db(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        payload: Any = None,
        prefer: str | None = None,
    ) -> Any:
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.request(
                    method,
                    f"{self.settings.normalized_supabase_url}/rest/v1/{table}",
                    headers=self._headers(prefer),
                    params=params,
                    json=payload,
                )
        except httpx.HTTPError as error:
            raise ApiError(
                503, "content_storage_unavailable", "정보 지원 데이터를 불러오지 못했습니다."
            ) from error
        if response.status_code >= 400:
            raise ApiError(502, "content_storage_failed", "정보 지원 데이터를 처리하지 못했습니다.")
        return response.json() if response.content else None

    @staticmethod
    def _normalized(value: str) -> str:
        return "".join(character.lower() for character in value if character.isalnum())

    async def _catalogs(self) -> list[dict[str, Any]]:
        return await self._db(
            "GET", "service_catalogs", params={"select": "*", "order": "display_name.asc"}
        )

    def _match_catalog(self, name: str, catalogs: list[dict[str, Any]]) -> dict[str, Any] | None:
        target = self._canonical_service(name)[0]
        for catalog in catalogs:
            if catalog.get("canonical_key") == target:
                return catalog
            names = [catalog["display_name"], *(catalog.get("match_names") or [])]
            if target and target in {self._canonical_service(candidate)[0] for candidate in names}:
                return catalog
        return None

    def _canonical_service(self, name: str) -> tuple[str, str, list[str]]:
        normalized = self._normalized(name)
        return self.SERVICE_ALIASES.get(normalized, (normalized, name.strip(), [name.strip()]))

    async def operator_status(self, user: CurrentUser) -> dict[str, bool]:
        return {"is_operator": self._operator(user)}

    async def collection_settings(self, user: CurrentUser) -> dict[str, Any]:
        self.require_operator(user)
        rows = await self._db(
            "GET",
            "content_collection_settings",
            params={"id": "eq.1", "select": "collection_enabled,interval_hours,updated_at", "limit": "1"},
        )
        return rows[0] if rows else {"collection_enabled": True, "interval_hours": 72, "updated_at": None}

    async def update_collection_settings(
        self, user: CurrentUser, enabled: bool, interval_hours: int
    ) -> dict[str, Any]:
        self.require_operator(user)
        if not 1 <= interval_hours <= 720:
            raise ApiError(422, "invalid_collection_interval", "수집 기간은 1~720시간 사이여야 합니다.")
        rows = await self._db(
            "PATCH",
            "content_collection_settings",
            params={"id": "eq.1"},
            payload={
                "collection_enabled": enabled,
                "interval_hours": interval_hours,
                "updated_at": datetime.now(UTC).isoformat(),
                "updated_by": str(user.id),
            },
            prefer="return=representation",
        )
        updated = rows[0] if rows else {"collection_enabled": enabled, "interval_hours": interval_hours}
        await self._audit(
            user,
            "collection_settings",
            "1",
            "update",
            "전체 자동 수집 설정 변경",
            None,
            updated,
        )
        return updated

    async def collection_status(self, user: CurrentUser) -> dict[str, Any]:
        items = await self._db(
            "GET",
            "items",
            params={
                "user_id": f"eq.{user.id}",
                "management_type": "eq.recurring_subscription",
                "actual_status": "eq.in_use",
                "select": "user_id,service_name",
            },
        )
        names = {row["service_name"].strip() for row in items if row.get("service_name")}
        if not names:
            return {
                "configured": bool(
                    self.settings.openai_api_key and self.settings.content_collection_cron_secret
                ),
                "status": "no_subscriptions",
                "service_count": 0,
                "last_checked_at": None,
            }
        catalogs = await self._catalogs()
        ids = [catalog["id"] for name in names if (catalog := self._match_catalog(name, catalogs))]
        if not ids:
            return {
                "configured": bool(
                    self.settings.openai_api_key and self.settings.content_collection_cron_secret
                ),
                "status": "awaiting_first_run",
                "service_count": len(names),
                "last_checked_at": None,
            }
        news = await self._db(
            "GET",
            "service_news",
            params={
                "catalog_id": f"in.({','.join(ids)})",
                "status": "eq.published",
                "select": "id",
                "limit": "1",
            },
        )
        runs = await self._db(
            "GET",
            "content_collection_runs",
            params={
                "catalog_id": f"in.({','.join(ids)})",
                "content_kind": "eq.news",
                "select": "outcome,checked_at",
                "order": "checked_at.desc",
                "limit": "1",
            },
        )
        if news:
            state = "ready"
        elif not runs:
            state = "awaiting_first_run"
        else:
            state = runs[0]["outcome"]
        return {
            "configured": bool(
                self.settings.openai_api_key and self.settings.content_collection_cron_secret
            ),
            "status": state,
            "service_count": len(names),
            "last_checked_at": runs[0]["checked_at"] if runs else None,
        }

    async def news_for_user(self, user: CurrentUser, limit: int = 20) -> list[dict[str, Any]]:
        items = await self._db(
            "GET",
            "items",
            params={
                "user_id": f"eq.{user.id}",
                "management_type": "eq.recurring_subscription",
                "actual_status": "eq.in_use",
                "select": "id,service_name,plan_name,payment_method",
            },
        )
        catalogs = await self._catalogs()
        profile_rows = await self._db(
            "GET",
            "profiles",
            params={"id": f"eq.{user.id}", "select": "country_code", "limit": "1"},
        )
        country = (profile_rows[0].get("country_code") if profile_rows else "KR") or "KR"
        matched: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            catalog = self._match_catalog(item["service_name"], catalogs)
            if catalog:
                matched.setdefault(catalog["id"], []).append(item)
        if not matched:
            return []
        rows = await self._db(
            "GET",
            "service_news",
            params={
                "catalog_id": f"in.({','.join(matched)})",
                "status": "eq.published",
                "select": "*",
                "order": "applies_on.desc.nullslast,announced_on.desc.nullslast,checked_at.desc",
                "limit": str(max(limit, 100)),
            },
        )
        catalog_by_id = {catalog["id"]: catalog for catalog in catalogs}
        scraps = await self._db(
            "GET",
            "user_news_scraps",
            params={"user_id": f"eq.{user.id}", "select": "news_id"},
        )
        scrapped_ids = {row["news_id"] for row in scraps}
        result = []
        for row in rows:
            matching_items = [
                item
                for item in matched[row["catalog_id"]]
                if not row.get("country_codes") or country in row["country_codes"]
            ]
            if matching_items:
                result.append(
                    {
                        **row,
                        "service_name": catalog_by_id[row["catalog_id"]]["display_name"],
                        "matching_item_ids": [item["id"] for item in matching_items],
                        "is_scrapped": row["id"] in scrapped_ids,
                        "relevance_summary": self._relevance_summary(row, matching_items, country),
                    }
                )
        priority = {
            "price": 0,
            "limit": 1,
            "benefit": 2,
            "ending": 3,
            "feature": 4,
            "content": 5,
            "other": 6,
        }
        result.sort(
            key=lambda row: row.get("announced_on") or row.get("applies_on") or "0000-00-00",
            reverse=True,
        )
        result.sort(key=lambda row: priority.get(row.get("news_type", "other"), 9))
        return result[:limit]

    async def ott_news_for_user(
        self, user: CurrentUser, limit: int = 18
    ) -> list[dict[str, Any]]:
        catalogs = [
            catalog for catalog in await self._catalogs() if catalog.get("is_ott_editorial")
        ]
        if not catalogs:
            return []
        profile_rows = await self._db(
            "GET",
            "profiles",
            params={"id": f"eq.{user.id}", "select": "country_code", "limit": "1"},
        )
        country = (profile_rows[0].get("country_code") if profile_rows else "KR") or "KR"
        rows = await self._db(
            "GET",
            "service_news",
            params={
                "catalog_id": f"in.({','.join(catalog['id'] for catalog in catalogs)})",
                "status": "eq.published",
                "is_ott_schedule": "eq.true",
                "select": "*",
                "order": "announced_on.desc.nullslast,checked_at.desc",
                "limit": str(limit),
            },
        )
        scraps = await self._db(
            "GET",
            "user_news_scraps",
            params={"user_id": f"eq.{user.id}", "select": "news_id"},
        )
        scrapped_ids = {row["news_id"] for row in scraps}
        names = {catalog["id"]: catalog["display_name"] for catalog in catalogs}
        return [
            {
                **row,
                "service_name": names[row["catalog_id"]],
                "is_scrapped": row["id"] in scrapped_ids,
                "relevance_summary": (
                    "구독 여부와 관계없이 제공하는 공식 OTT 공개 예정작 소식이에요."
                ),
            }
            for row in rows
            if not row.get("country_codes") or country in row["country_codes"]
        ]

    @staticmethod
    def _relevance_summary(news: dict[str, Any], items: list[dict[str, Any]], country: str) -> str:
        if news.get("country_codes") and country not in news["country_codes"]:
            return "선택한 국가에는 적용 대상이 아닐 수 있어요."
        return news.get("impact_summary") or "등록한 구독 서비스와 관련된 공식 소식이에요."

    async def scraps_for_user(self, user: CurrentUser) -> list[dict[str, Any]]:
        scraps = await self._db(
            "GET",
            "user_news_scraps",
            params={
                "user_id": f"eq.{user.id}",
                "select": "news_id,created_at",
                "order": "created_at.desc",
            },
        )
        if not scraps:
            return []
        ids = [row["news_id"] for row in scraps]
        news = await self._db(
            "GET",
            "service_news",
            params={"id": f"in.({','.join(ids)})", "select": "*"},
        )
        catalogs = {row["id"]: row for row in await self._catalogs()}
        by_id = {row["id"]: row for row in news}
        result = []
        for scrap in scraps:
            row = by_id.get(scrap["news_id"])
            if not row or row.get("status") not in {"published", "archived"}:
                result.append(
                    {
                        "id": scrap["news_id"],
                        "is_available": False,
                        "scrapped_at": scrap["created_at"],
                        "is_scrapped": True,
                    }
                )
                continue
            result.append(
                {
                    **row,
                    "service_name": catalogs.get(row["catalog_id"], {}).get("display_name"),
                    "is_available": True,
                    "is_archived": row.get("status") == "archived",
                    "scrapped_at": scrap["created_at"],
                    "is_scrapped": True,
                }
            )
        return result

    async def add_scrap(self, user: CurrentUser, news_id: UUID) -> dict[str, Any]:
        news = await self._db(
            "GET",
            "service_news",
            params={"id": f"eq.{news_id}", "status": "eq.published", "select": "id", "limit": "1"},
        )
        if not news:
            raise ApiError(404, "news_not_available", "현재 제공되는 소식을 찾을 수 없습니다.")
        await self._db(
            "POST",
            "user_news_scraps",
            payload={"user_id": str(user.id), "news_id": str(news_id)},
            prefer="resolution=ignore-duplicates,return=minimal",
        )
        return {"news_id": str(news_id), "is_scrapped": True}

    async def remove_scrap(self, user: CurrentUser, news_id: UUID) -> dict[str, Any]:
        await self._db(
            "DELETE",
            "user_news_scraps",
            params={"user_id": f"eq.{user.id}", "news_id": f"eq.{news_id}"},
        )
        return {"news_id": str(news_id), "is_scrapped": False}

    async def item_content(self, user: CurrentUser, item_id: UUID) -> dict[str, Any]:
        rows = await self._db(
            "GET",
            "items",
            params={
                "id": f"eq.{item_id}",
                "user_id": f"eq.{user.id}",
                "select": "id,service_name,plan_name,payment_method,management_type",
                "limit": "1",
            },
        )
        if not rows:
            raise ApiError(404, "item_not_found", "관리 항목을 찾을 수 없습니다.")
        item = rows[0]
        if item["management_type"] != "recurring_subscription":
            return {
                "catalog": None,
                "guides": [],
                "news": [],
                "support": {"cancellation": "management_only", "news": "management_only"},
                "payment_path_needed": False,
            }
        profile_rows = await self._db(
            "GET",
            "profiles",
            params={"id": f"eq.{user.id}", "select": "country_code", "limit": "1"},
        )
        country = (profile_rows[0].get("country_code") if profile_rows else "KR") or "KR"
        catalogs = await self._catalogs()
        catalog = self._match_catalog(item["service_name"], catalogs)
        if not catalog:
            return {
                "catalog": None,
                "guides": [],
                "news": [],
                "support": {"cancellation": "management_only", "news": "management_only"},
            }
        guides = await self._db(
            "GET",
            "cancellation_guides",
            params={
                "catalog_id": f"eq.{catalog['id']}",
                "status": "in.(published,recheck_required)",
                "select": "*",
                "order": "payment_path.asc",
            },
        )
        news = await self._db(
            "GET",
            "service_news",
            params={
                "catalog_id": f"eq.{catalog['id']}",
                "status": "eq.published",
                "select": "*",
                "order": "applies_on.desc.nullslast,announced_on.desc.nullslast",
                "limit": "5",
            },
        )
        guides = [
            guide
            for guide in guides
            if guide["country_code"] == country
            and bool(item.get("payment_method"))
            and self._normalized(guide["payment_path"]) == self._normalized(item["payment_method"])
            and (not guide.get("plan_scope") or guide["plan_scope"] == item.get("plan_name"))
        ]
        news = [
            entry
            for entry in news
            if not entry.get("country_codes") or country in entry["country_codes"]
        ]
        return {
            "catalog": catalog,
            "guides": guides,
            "news": news,
            "support": {
                "cancellation": catalog["cancellation_support_status"],
                "news": catalog["news_support_status"],
            },
            "payment_path_needed": not bool(item.get("payment_method")),
        }

    async def review_data(self, user: CurrentUser) -> dict[str, Any]:
        self.require_operator(user)
        catalogs = await self._catalogs()
        guides = await self._db(
            "GET", "cancellation_guides", params={"select": "*", "order": "updated_at.desc"}
        )
        news = await self._db(
            "GET", "service_news", params={"select": "*", "order": "updated_at.desc"}
        )
        runs = await self._db(
            "GET",
            "content_collection_runs",
            params={"select": "*", "order": "checked_at.desc", "limit": "30"},
        )
        audit = await self._db(
            "GET",
            "content_review_audit",
            params={"select": "*", "order": "created_at.desc", "limit": "50"},
        )
        announcements = await self._db(
            "GET",
            "operator_announcements",
            params={"select": "*", "order": "created_at.desc", "limit": "50"},
        )
        catalog_by_id = {catalog["id"]: catalog for catalog in catalogs}
        news_by_catalog: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in news:
            catalog = catalog_by_id.get(row.get("catalog_id"), {})
            row["catalog_name"] = catalog.get("display_name", "알 수 없는 서비스")
            row["catalog_match_names"] = catalog.get("match_names") or []
            news_by_catalog.setdefault(row.get("catalog_id", ""), []).append(row)

        latest_run_by_catalog: dict[str, dict[str, Any]] = {}
        for run in runs:
            catalog_id = run.get("catalog_id")
            if catalog_id and catalog_id not in latest_run_by_catalog:
                latest_run_by_catalog[catalog_id] = run
            if catalog_id:
                run["catalog_name"] = catalog_by_id.get(catalog_id, {}).get(
                    "display_name", "알 수 없는 서비스"
                )

        collection_services = []
        for catalog in catalogs:
            service_news = news_by_catalog.get(catalog["id"], [])
            latest_run = latest_run_by_catalog.get(catalog["id"])
            collection_services.append(
                {
                    "id": catalog["id"],
                    "display_name": catalog.get("display_name"),
                    "match_names": catalog.get("match_names") or [],
                    "is_ott_editorial": bool(catalog.get("is_ott_editorial")),
                    "collection_enabled": catalog.get("collection_enabled", True),
                    "active_subscriber_count": catalog.get("active_subscriber_count", 0),
                    "news_support_status": catalog.get("news_support_status"),
                    "last_news_check_at": catalog.get("last_news_check_at"),
                    "next_news_check_at": catalog.get("next_news_check_at"),
                    "latest_run": latest_run,
                    "published_news_count": sum(
                        1 for row in service_news if row.get("status") == "published"
                    ),
                    "pending_review_news_count": sum(
                        1 for row in service_news if row.get("status") == "pending_review"
                    ),
                    "latest_news": service_news[:3],
                }
            )

        outcomes = Counter(run.get("outcome") for run in runs if run.get("outcome"))
        last_checked_at = next(
            (run.get("checked_at") for run in runs if run.get("checked_at")), None
        )
        return {
            "catalogs": catalogs,
            "guides": guides,
            "news": news,
            "runs": runs,
            "collection": {
                "service_count": len(collection_services),
                "last_checked_at": last_checked_at,
                "outcomes": dict(outcomes),
            },
            "collection_services": collection_services,
            "collection_settings": await self.collection_settings(user),
            "audit": audit,
            "announcements": announcements,
        }

    async def create_catalog(self, user: CurrentUser, payload: dict[str, Any]) -> dict[str, Any]:
        self.require_operator(user)
        row = await self._db(
            "POST", "service_catalogs", payload=payload, prefer="return=representation"
        )
        await self._audit(
            user, "catalog", row[0]["id"], "create", "지원 카탈로그 등록", None, row[0]
        )
        return row[0]

    async def set_catalog_collection_enabled(
        self, user: CurrentUser, catalog_id: str, enabled: bool
    ) -> dict[str, Any]:
        self.require_operator(user)
        before = await self._db(
            "GET",
            "service_catalogs",
            params={"id": f"eq.{catalog_id}", "select": "*", "limit": "1"},
        )
        if not before:
            raise ApiError(404, "catalog_not_found", "서비스 카탈로그를 찾을 수 없습니다.")
        rows = await self._db(
            "PATCH",
            "service_catalogs",
            params={"id": f"eq.{catalog_id}"},
            payload={"collection_enabled": enabled},
            prefer="return=representation",
        )
        updated = rows[0] if rows else {**before[0], "collection_enabled": enabled}
        await self._audit(
            user,
            "catalog",
            catalog_id,
            "collection_enabled" if enabled else "collection_disabled",
            "운영자 수집 제어 변경",
            before[0],
            updated,
        )
        return updated

    async def delete_catalog(self, user: CurrentUser, catalog_id: str) -> dict[str, Any]:
        self.require_operator(user)
        before = await self._db(
            "GET",
            "service_catalogs",
            params={"id": f"eq.{catalog_id}", "select": "*", "limit": "1"},
        )
        if not before:
            raise ApiError(404, "catalog_not_found", "서비스 카탈로그를 찾을 수 없습니다.")
        await self._audit(
            user,
            "catalog",
            catalog_id,
            "delete",
            "운영자 서비스 카탈로그 삭제",
            before[0],
            None,
        )
        await self._db("DELETE", "service_catalogs", params={"id": f"eq.{catalog_id}"})
        return {"id": catalog_id, "deleted": True}

    @staticmethod
    def _validate_source(payload: dict[str, Any], entity: str) -> None:
        parsed = urlparse(str(payload.get("source_url", "")))
        domain = str(payload.get("source_domain", "")).lower().strip()
        if parsed.scheme != "https" or not parsed.hostname or parsed.hostname.lower() != domain:
            raise ApiError(
                422,
                "official_source_required",
                "HTTPS 공식 출처 URL과 출처 도메인이 일치해야 합니다.",
            )
        if not payload.get("checked_at"):
            raise ApiError(422, "checked_at_required", "공식 출처 확인일이 필요합니다.")
        if entity == "cancellation_guide" and not payload.get("steps"):
            raise ApiError(422, "guide_steps_required", "확인한 해지 단계가 필요합니다.")
        if entity == "news" and not (payload.get("announced_on") or payload.get("applies_on")):
            raise ApiError(422, "news_date_required", "발표일 또는 적용일이 필요합니다.")

    async def create_content(
        self, user: CurrentUser, entity: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self.require_operator(user)
        self._validate_source(payload, entity)
        table = "cancellation_guides" if entity == "cancellation_guide" else "service_news"
        row = await self._db("POST", table, payload=payload, prefer="return=representation")
        await self._audit(
            user, entity, row[0]["id"], "create", "공식 출처 기반 초안 등록", None, row[0]
        )
        return row[0]

    async def record_collection_run(
        self, user: CurrentUser, payload: dict[str, Any]
    ) -> dict[str, Any]:
        self.require_operator(user)
        row = await self._db(
            "POST",
            "content_collection_runs",
            payload=payload,
            prefer="return=representation",
        )
        await self._audit(
            user,
            "collection_run",
            row[0]["id"],
            "record",
            payload["outcome"],
            None,
            row[0],
        )
        return row[0]

    async def _ensure_ott_editorial_catalogs(
        self, catalogs: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        for canonical_key, display_name, aliases in self.OTT_EDITORIAL_SERVICES:
            catalog = self._match_catalog(display_name, catalogs)
            if not catalog:
                created = await self._db(
                    "POST",
                    "service_catalogs",
                    payload={
                        "display_name": display_name,
                        "canonical_key": canonical_key,
                        "match_names": aliases,
                        "news_support_status": "collecting",
                        "cancellation_support_status": "management_only",
                        "is_ott_editorial": True,
                        "next_news_check_at": datetime.now(UTC).isoformat(),
                    },
                    params={"on_conflict": "canonical_key"},
                    prefer="resolution=merge-duplicates,return=representation",
                )
                catalogs.append(created[0])
            elif not catalog.get("is_ott_editorial"):
                await self._db(
                    "PATCH",
                    "service_catalogs",
                    params={"id": f"eq.{catalog['id']}"},
                    payload={"is_ott_editorial": True},
                )
                catalog["is_ott_editorial"] = True
        return catalogs

    async def process_due_news(self) -> dict[str, int]:
        if not self.settings.openai_api_key:
            raise ApiError(
                503, "openai_not_configured", "자동 소식 수집 연결이 설정되지 않았습니다."
            )
        setting_rows = await self._db(
            "GET",
            "content_collection_settings",
            params={"id": "eq.1", "select": "collection_enabled,interval_hours", "limit": "1"},
        )
        collection_setting = setting_rows[0] if setting_rows else {}
        collection_enabled = collection_setting.get("collection_enabled", True)
        interval_hours = int(
            collection_setting.get("interval_hours") or self.settings.content_collection_interval_hours
        )
        cleanup_rows = await self._db("POST", "rpc/cleanup_old_service_news", payload={}) or []
        cleanup = cleanup_rows[0] if cleanup_rows else {}
        items = await self._db(
            "GET",
            "items",
            params={
                "management_type": "eq.recurring_subscription",
                "actual_status": "eq.in_use",
                "select": "user_id,service_name",
            },
        )
        profiles = await self._db("GET", "profiles", params={"select": "id,country_code,timezone"})
        profile_by_id = {row["id"]: row for row in profiles}
        catalogs = await self._catalogs()
        if self.settings.content_ott_editorial_enabled:
            catalogs = await self._ensure_ott_editorial_catalogs(catalogs)
        counts: Counter[str] = Counter()
        service_locales: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for item in items:
            name = item["service_name"].strip()
            canonical_key, display_name, aliases = self._canonical_service(name)
            catalog = self._match_catalog(name, catalogs)
            if not catalog:
                created = await self._db(
                    "POST",
                    "service_catalogs",
                    payload={
                        "display_name": display_name,
                        "canonical_key": canonical_key,
                        "match_names": aliases,
                        "news_support_status": "collecting",
                        "cancellation_support_status": "management_only",
                        "next_news_check_at": datetime.now(UTC).isoformat(),
                    },
                    params={"on_conflict": "canonical_key"},
                    prefer="resolution=merge-duplicates,return=representation",
                )
                catalog = created[0]
                catalogs.append(catalog)
            elif not catalog.get("canonical_key"):
                merged_aliases = sorted(set([*(catalog.get("match_names") or []), *aliases]))
                await self._db(
                    "PATCH",
                    "service_catalogs",
                    params={"id": f"eq.{catalog['id']}"},
                    payload={"canonical_key": canonical_key, "match_names": merged_aliases},
                )
                catalog["canonical_key"] = canonical_key
                catalog["match_names"] = merged_aliases
            counts[catalog["id"]] += 1
            profile = profile_by_id.get(item.get("user_id")) or {}
            service_locales[catalog["id"]].append(
                (profile.get("country_code") or "KR", profile.get("timezone") or "Asia/Seoul")
            )
        for catalog in catalogs:
            await self._db(
                "PATCH",
                "service_catalogs",
                params={"id": f"eq.{catalog['id']}"},
                payload={"active_subscriber_count": counts[catalog["id"]]},
            )
        now = datetime.now(UTC)
        due = sorted(
            [
                catalog
                for catalog in catalogs
                if collection_enabled and catalog.get("collection_enabled", True)
                and (counts[catalog["id"]] > 0 or catalog.get("is_ott_editorial"))
                and (
                    not catalog.get("next_news_check_at")
                    or datetime.fromisoformat(catalog["next_news_check_at"].replace("Z", "+00:00"))
                    <= now
                )
            ],
            key=lambda row: row.get("last_news_check_at") or "",
        )
        result = {
            "services": sum(
                1
                for catalog in catalogs
                if collection_enabled and catalog.get("collection_enabled", True)
                and (counts[catalog["id"]] > 0 or catalog.get("is_ott_editorial"))
            ),
            "due": len(due),
            "searched": 0,
            "published": 0,
            "pending_review": 0,
            "failed": 0,
            "budget_limited": 0,
            "unchanged": 0,
            "precheck_failed": 0,
            "archived": int(cleanup.get("archived_count") or 0),
            "deleted": int(cleanup.get("deleted_count") or 0),
        }
        estimate = self._reservation_cost()
        for catalog in due:
            claimed = await self._db(
                "POST",
                "rpc/claim_content_collection_job",
                payload={
                    "p_catalog_id": catalog["id"],
                    "p_daily_job_limit": self.settings.content_daily_service_job_limit,
                    "p_daily_cost_limit": self.settings.content_daily_cost_limit_usd,
                    "p_total_cost_limit": self.settings.content_development_total_limit_usd,
                    "p_reserved_cost": estimate,
                    "p_interval_hours": interval_hours,
                },
            )
            if not claimed:
                continue
            if claimed[0].get("claim_status") == "budget_limited":
                result["budget_limited"] += 1
                continue
            run_id = claimed[0]["run_id"]
            try:
                precheck = await self._precheck_sources(catalog["id"])
                if precheck in {"unchanged", "precheck_failed"}:
                    await self._finish_run(
                        run_id,
                        precheck,
                        {
                            "cost_known": 1,
                            "api_requests": 0,
                            "input_tokens": 0,
                            "cached_input_tokens": 0,
                            "output_tokens": 0,
                            "web_search_calls": 0,
                        },
                        estimate,
                    )
                    result[precheck] += 1
                    await self._schedule_next(catalog["id"], interval_hours)
                    continue
                locale_counts = Counter(service_locales.get(catalog["id"], []))
                country, timezone = (
                    locale_counts.most_common(1)[0][0] if locale_counts else ("KR", "Asia/Seoul")
                )
                payload, cited_urls, usage = await self._search_service_news(
                    catalog["display_name"],
                    country,
                    timezone,
                    bool(catalog.get("is_ott_editorial")),
                )
                stored = await self._store_search_result(catalog, payload, cited_urls)
                result["published"] += stored["published"]
                result["pending_review"] += stored["pending_review"]
                outcome = (
                    payload["outcome"]
                    if stored["accepted"] or not payload["news"]
                    else "source_failed"
                )
                await self._finish_run(
                    run_id, outcome, usage, estimate, f"accepted={stored['accepted']}"
                )
                result["searched"] += 1
            except (ApiError, httpx.HTTPError, ValueError, KeyError, json.JSONDecodeError) as error:
                await self._finish_run(
                    run_id, "search_failed", {"api_requests": 1}, estimate, type(error).__name__
                )
                result["failed"] += 1
            await self._schedule_next(catalog["id"], interval_hours)
        return result

    def _reservation_cost(self) -> float:
        token_cost = (
            self.settings.content_max_input_tokens
            * self.settings.content_model_input_cost_per_million_usd
            + self.settings.content_max_output_tokens
            * self.settings.content_model_output_cost_per_million_usd
        ) / 1_000_000
        tool_cost = (
            max(1, self.settings.content_max_web_search_calls)
            * self.settings.content_web_search_cost_per_call_usd
        )
        return round(
            max(self.settings.content_estimated_cost_per_search_usd, token_cost + tool_cost), 6
        )

    async def _schedule_next(self, catalog_id: str, interval_hours: int | None = None) -> None:
        now = datetime.now(UTC)
        await self._db(
            "PATCH",
            "service_catalogs",
            params={"id": f"eq.{catalog_id}"},
            payload={
                "last_news_check_at": now.isoformat(),
                "next_news_check_at": (
                    now + timedelta(
                        hours=interval_hours or self.settings.content_collection_interval_hours
                    )
                ).isoformat(),
                "collection_lease_until": None,
            },
        )

    async def _finish_run(
        self,
        run_id: str,
        outcome: str,
        usage: dict[str, int],
        reserved: float,
        details: str = "",
    ) -> None:
        known = bool(usage.get("cost_known"))
        input_tokens = int(usage.get("input_tokens", 0))
        cached_tokens = int(usage.get("cached_input_tokens", 0))
        output_tokens = int(usage.get("output_tokens", 0))
        searches = int(usage.get("web_search_calls", 0))
        actual = None
        if known:
            uncached = max(0, input_tokens - cached_tokens)
            actual = round(
                (
                    uncached * self.settings.content_model_input_cost_per_million_usd
                    + cached_tokens * self.settings.content_model_cached_input_cost_per_million_usd
                    + output_tokens * self.settings.content_model_output_cost_per_million_usd
                )
                / 1_000_000
                + searches * self.settings.content_web_search_cost_per_call_usd,
                6,
            )
        await self._db(
            "PATCH",
            "content_collection_runs",
            params={"id": f"eq.{run_id}"},
            payload={
                "outcome": outcome,
                "status": "finished"
                if outcome not in {"search_failed", "precheck_failed"}
                else "failed",
                "details": details,
                "actual_cost_usd": actual,
                "actual_cost_known": known,
                "api_request_count": int(usage.get("api_requests", 0)),
                "web_search_call_count": searches,
                "input_tokens": input_tokens,
                "cached_input_tokens": cached_tokens,
                "output_tokens": output_tokens,
                "finished_at": datetime.now(UTC).isoformat(),
            },
        )

    async def _precheck_sources(self, catalog_id: str) -> str:
        sources = await self._db(
            "GET",
            "service_collection_sources",
            params={"catalog_id": f"eq.{catalog_id}", "enabled": "eq.true", "select": "*"},
        )
        if not sources:
            return "unsupported"
        changed = False
        for source in sources:
            headers = {}
            if source.get("etag"):
                headers["If-None-Match"] = source["etag"]
            if source.get("last_modified"):
                headers["If-Modified-Since"] = source["last_modified"]
            try:
                async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                    response = await client.get(source["source_url"], headers=headers)
                if response.status_code == 304:
                    await self._db(
                        "PATCH",
                        "service_collection_sources",
                        params={"id": f"eq.{source['id']}"},
                        payload={"last_checked_at": datetime.now(UTC).isoformat()},
                    )
                    continue
                response.raise_for_status()
                if source["source_kind"] == "conditional_page" and not (
                    response.headers.get("etag") or response.headers.get("last-modified")
                ):
                    return "precheck_failed"
                signature = self._source_signature(response.text, source["source_kind"])
                is_changed = signature != source.get("content_hash")
                changed = changed or is_changed
                await self._db(
                    "PATCH",
                    "service_collection_sources",
                    params={"id": f"eq.{source['id']}"},
                    payload={
                        "etag": response.headers.get("etag"),
                        "last_modified": response.headers.get("last-modified"),
                        "content_hash": signature,
                        "last_checked_at": datetime.now(UTC).isoformat(),
                        **(
                            {"last_changed_at": datetime.now(UTC).isoformat()} if is_changed else {}
                        ),
                    },
                )
            except httpx.HTTPError:
                return "precheck_failed"
        return "changed" if changed else "unchanged"

    @staticmethod
    def _source_signature(content: str, kind: str) -> str:
        if kind in {"rss", "atom"}:
            root = ET.fromstring(content)
            values = []
            for element in root.iter():
                tag = element.tag.rsplit("}", 1)[-1].lower()
                if tag in {"guid", "id", "link", "title", "pubdate", "published", "updated"}:
                    value = (element.text or element.attrib.get("href") or "").strip()
                    if value:
                        values.append(f"{tag}:{value}")
            content = "\n".join(values)
        elif kind == "json":
            content = json.dumps(json.loads(content), sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(content.encode("utf-8")).hexdigest()

    async def _search_service_news(
        self,
        service_name: str,
        country: str,
        timezone: str,
        is_ott_editorial: bool = False,
    ) -> tuple[dict[str, Any], set[str], dict[str, int]]:
        editorial_instruction = (
            "This service is part of the shared OTT editorial feed. Prioritize one official "
            "monthly or weekly announcement that groups upcoming titles for the selected country. "
            "Set is_ott_schedule=true only for an official announcement primarily about upcoming "
            "or newly scheduled titles. Do not claim that a partial list is the complete schedule. "
            if is_ott_editorial
            else "Set is_ott_schedule=false unless this is an official OTT schedule announcement. "
        )
        prompt = (
            "Find official announcements from the last 14 days about the recurring "
            f"subscription service named {service_name!r}. Prioritize official information "
            f"applicable to country {country}; when no localized official source exists, include "
            "a relevant global first-party announcement and identify its source country. "
            "Search only first-party official "
            "websites, official help centers, official blogs, or official release notes. Look "
            "for subscription price, plan, feature, model, usage limit, benefit, content "
            "addition, upcoming or newly released subscription content, content ending, service "
            "incidents, or official security/privacy notices. For OTT services, official upcoming "
            "title schedules, new title announcements, and leaving-soon notices are important. "
            "Do not use leaks, rumors, blogs, communities, news "
            "summaries, app stores, aggregators, or guessed URLs as sources. Do not treat a "
            "feature announcement as available to every plan unless the official source "
            "states that. Return no_new_content when no qualifying official announcement is "
            "found. Do not make an old announcement recent merely because it was collected now. "
            "For release-note pages containing multiple announcements, set official_item_id to "
            "the announcement heading, anchor, or official post ID. Bundle OTT titles from one "
            "official schedule into one item. Exclude minor UI changes, generic promotions, and "
            "repeated notices. Dates must be YYYY-MM-DD or null. Use two-letter country "
            "codes only when "
            "explicitly stated. Keep unknown plan/country conditions empty and mark "
            "needs_confirmation. Write title, summary, and impact_summary in natural Korean, "
            "each no longer than 200 characters. Preserve the official source title separately. "
            "Set source_language to a short language code such as ko or en. Set "
            "source_country_code only when the official page targets a specific country; use "
            "null for a global announcement. "
            + editorial_instruction
        )
        request = {
            "model": self.settings.content_collection_model,
            "tools": [
                {
                    "type": "web_search",
                    "search_context_size": "medium",
                    "return_token_budget": max(
                        1000,
                        self.settings.content_max_input_tokens
                        // max(1, self.settings.content_max_web_search_calls)
                        - 1000,
                    ),
                    "user_location": {
                        "type": "approximate",
                        "country": country,
                        "timezone": timezone,
                    },
                }
            ],
            "tool_choice": "required",
            "max_tool_calls": max(1, self.settings.content_max_web_search_calls),
            "max_output_tokens": self.settings.content_max_output_tokens,
            "input": prompt,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "subscription_news",
                    "strict": True,
                    "schema": NEWS_SCHEMA,
                }
            },
            "include": ["web_search_call.results"],
        }
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={
                    "Authorization": f"Bearer {self.settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=request,
            )
        if response.status_code >= 400:
            raise ApiError(502, "content_search_failed", "공식 소식 검색을 완료하지 못했습니다.")
        body = response.json()
        text = ""
        cited_urls: set[str] = set()
        for output in body.get("output", []):
            if output.get("type") == "web_search_call":
                for item in output.get("results") or []:
                    if item.get("url"):
                        cited_urls.add(item["url"])
            if output.get("type") == "message":
                for content in output.get("content", []):
                    if content.get("type") == "output_text":
                        text += content.get("text", "")
                        for annotation in content.get("annotations") or []:
                            if annotation.get("url"):
                                cited_urls.add(annotation["url"])
        usage = body.get("usage") or {}
        cached = (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0
        tool_usage = body.get("tool_usage") or {}
        web_search_calls = (tool_usage.get("web_search") or {}).get("num_requests")
        if web_search_calls is None:
            web_search_calls = sum(
                1
                for output in body.get("output", [])
                if output.get("type") == "web_search_call"
                and (output.get("action") or {}).get("type", "search") == "search"
            )
        return (
            json.loads(text),
            cited_urls,
            {
                "cost_known": 1,
                "api_requests": 1,
                "input_tokens": int(usage.get("input_tokens") or 0),
                "cached_input_tokens": int(cached),
                "output_tokens": int(usage.get("output_tokens") or 0),
                "web_search_calls": int(web_search_calls),
            },
        )

    async def _store_search_result(
        self, catalog: dict[str, Any], payload: dict[str, Any], cited_urls: set[str]
    ) -> dict[str, int]:
        counts = {"accepted": 0, "published": 0, "pending_review": 0}
        for entry in payload.get("news", []):
            url = entry.get("source_url", "")
            parsed = urlparse(url)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or url not in cited_urls
                or parsed.hostname.lower() != entry.get("source_domain", "").lower()
            ):
                continue
            if not (entry.get("announced_on") or entry.get("applies_on")):
                continue
            status = "published" if entry.pop("official_source", False) else "pending_review"
            entry["title"] = entry["title"][:200]
            entry["summary"] = entry["summary"][:200]
            if entry.get("impact_summary"):
                entry["impact_summary"] = entry["impact_summary"][:200]
            row = {
                **entry,
                "catalog_id": catalog["id"],
                "checked_at": datetime.now(UTC).isoformat(),
                "last_verified_at": datetime.now(UTC).isoformat(),
                "status": status,
            }
            identity = "|".join(
                [
                    url.rstrip("/"),
                    str(entry.get("official_item_id") or ""),
                    str(entry.get("announced_on") or ""),
                    self._normalized(entry["title"]),
                ]
            )
            row["announcement_key"] = hashlib.sha256(identity.encode("utf-8")).hexdigest()
            existing = await self._db(
                "GET",
                "service_news",
                params={
                    "catalog_id": f"eq.{catalog['id']}",
                    "announcement_key": f"eq.{row['announcement_key']}",
                    "select": "id",
                    "limit": "1",
                },
            )
            if existing:
                await self._db(
                    "PATCH", "service_news", params={"id": f"eq.{existing[0]['id']}"}, payload=row
                )
            else:
                await self._db("POST", "service_news", payload=row)
            counts["accepted"] += 1
            counts[status] += 1
        if counts["published"]:
            await self._db(
                "PATCH",
                "service_catalogs",
                params={"id": f"eq.{catalog['id']}"},
                payload={"news_support_status": "supported"},
            )
        elif counts["pending_review"]:
            await self._db(
                "PATCH",
                "service_catalogs",
                params={"id": f"eq.{catalog['id']}"},
                payload={"news_support_status": "verifying"},
            )
        return counts

    async def announcements(self) -> list[dict[str, Any]]:
        return await self._db(
            "GET",
            "operator_announcements",
            params={
                "status": "eq.published",
                "select": "id,title,body,published_at,created_at",
                "order": "published_at.desc",
                "limit": "20",
            },
        )

    async def create_announcement(self, user: CurrentUser, title: str, body: str) -> dict[str, Any]:
        self.require_operator(user)
        row = await self._db(
            "POST",
            "operator_announcements",
            payload={
                "title": title,
                "body": body,
                "created_by": str(user.id),
                "updated_by": str(user.id),
            },
            prefer="return=representation",
        )
        await self._audit(
            user, "announcement", row[0]["id"], "create", "운영 공지 초안 등록", None, row[0]
        )
        return row[0]

    async def review_announcement(
        self, user: CurrentUser, entity_id: UUID, status: str, reason: str
    ) -> dict[str, Any]:
        self.require_operator(user)
        if status not in {"draft", "published", "hidden"}:
            raise ApiError(422, "invalid_announcement_status", "공지 상태가 올바르지 않습니다.")
        before = await self._db(
            "GET",
            "operator_announcements",
            params={"id": f"eq.{entity_id}", "select": "*", "limit": "1"},
        )
        if not before:
            raise ApiError(404, "announcement_not_found", "공지를 찾을 수 없습니다.")
        payload = {
            "status": status,
            "updated_by": str(user.id),
            "published_at": datetime.now(UTC).isoformat()
            if status == "published"
            else before[0].get("published_at"),
        }
        after = await self._db(
            "PATCH",
            "operator_announcements",
            params={"id": f"eq.{entity_id}"},
            payload=payload,
            prefer="return=representation",
        )
        await self._audit(
            user, "announcement", str(entity_id), f"status:{status}", reason, before[0], after[0]
        )
        return after[0]

    async def delete_announcement(self, user: CurrentUser, entity_id: UUID) -> dict[str, Any]:
        self.require_operator(user)
        before = await self._db(
            "GET",
            "operator_announcements",
            params={"id": f"eq.{entity_id}", "select": "*", "limit": "1"},
        )
        if not before:
            raise ApiError(404, "announcement_not_found", "공지를 찾을 수 없습니다.")
        await self._audit(
            user,
            "announcement",
            str(entity_id),
            "delete",
            "운영 공지 삭제",
            before[0],
            None,
        )
        await self._db("DELETE", "operator_announcements", params={"id": f"eq.{entity_id}"})
        return {"id": str(entity_id), "deleted": True}

    async def review(
        self, user: CurrentUser, entity: str, entity_id: UUID, status: str, reason: str
    ) -> dict[str, Any]:
        self.require_operator(user)
        table = "cancellation_guides" if entity == "cancellation_guide" else "service_news"
        allowed = {
            "cancellation_guide": {
                "draft",
                "pending_review",
                "published",
                "recheck_required",
                "hidden",
            },
            "news": {"draft", "pending_review", "published", "hidden"},
        }
        if status not in allowed[entity]:
            raise ApiError(422, "invalid_review_status", "검수 상태가 올바르지 않습니다.")
        before = await self._db(
            "GET", table, params={"id": f"eq.{entity_id}", "select": "*", "limit": "1"}
        )
        if not before:
            raise ApiError(404, "content_not_found", "검수할 정보를 찾을 수 없습니다.")
        if status == "published":
            self._validate_source(before[0], entity)
        payload = {
            "status": status,
            "reviewed_by": str(user.id),
            "reviewed_at": "now()",
            "review_reason": reason,
        }
        # PostgREST cannot treat now() as SQL, so use an ISO value supplied by Python.
        from datetime import UTC, datetime

        payload["reviewed_at"] = datetime.now(UTC).isoformat()
        after = await self._db(
            "PATCH",
            table,
            params={"id": f"eq.{entity_id}"},
            payload=payload,
            prefer="return=representation",
        )
        support_column = (
            "cancellation_support_status"
            if entity == "cancellation_guide"
            else "news_support_status"
        )
        support_status = "supported" if status == "published" else "verifying"
        if status == "hidden":
            visible_status = (
                "in.(published,recheck_required)"
                if entity == "cancellation_guide"
                else "eq.published"
            )
            visible = await self._db(
                "GET",
                table,
                params={
                    "catalog_id": f"eq.{after[0]['catalog_id']}",
                    "status": visible_status,
                    "select": "id",
                    "limit": "1",
                },
            )
            support_status = "supported" if visible else "verifying"
        await self._db(
            "PATCH",
            "service_catalogs",
            params={"id": f"eq.{after[0]['catalog_id']}"},
            payload={support_column: support_status},
        )
        await self._audit(
            user, entity, str(entity_id), f"status:{status}", reason, before[0], after[0]
        )
        return after[0]

    async def _audit(
        self,
        user: CurrentUser,
        entity: str,
        entity_id: str,
        action: str,
        reason: str,
        before: Any,
        after: Any,
    ) -> None:
        await self._db(
            "POST",
            "content_review_audit",
            payload={
                "operator_id": str(user.id),
                "entity_type": entity,
                "entity_id": entity_id,
                "action": action,
                "reason": reason,
                "before_data": before,
                "after_data": after,
            },
        )


@lru_cache
def get_content_service() -> ContentService:
    return ContentService(get_settings())
