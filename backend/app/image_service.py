from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.errors import ApiError
from app.security import CurrentUser

MAX_IMAGE_BYTES = 10 * 1024 * 1024
SUPPORTED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
BUCKET = "user-images"

EXTRACTABLE_FIELDS = (
    "service_name",
    "plan_name",
    "provider_name",
    "amount",
    "currency",
    "unit_name",
    "billing_cycle",
    "start_date_value",
    "start_date_precision",
    "target_date_value",
    "target_date_precision",
    "conditions",
    "actual_status",
    "lifecycle_status",
    "auto_renewal_status",
    "usage_plan",
    "payment_method",
    "category",
    "memo",
)

EXTRACTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "management_type": {
            "type": "string",
            "enum": [
                "recurring_subscription",
                "fixed_term_membership",
                "gifticon",
                "coupon",
                "voucher",
                "points",
                "warranty",
                "other_deadline",
            ],
        },
        "service_name": {"type": ["string", "null"]},
        "plan_name": {"type": ["string", "null"]},
        "provider_name": {"type": ["string", "null"]},
        "amount": {"type": ["number", "null"]},
        "currency": {"type": ["string", "null"]},
        "unit_name": {"type": ["string", "null"]},
        "billing_cycle": {
            "type": ["string", "null"],
            "enum": ["monthly", "yearly", "custom", None],
        },
        "start_date_value": {"type": ["string", "null"]},
        "start_date_precision": {"type": ["string", "null"], "enum": ["day", "month", None]},
        "target_date_value": {"type": ["string", "null"]},
        "target_date_precision": {"type": ["string", "null"], "enum": ["day", "month", None]},
        "conditions": {"type": ["string", "null"]},
        "actual_status": {
            "type": ["string", "null"],
            "enum": [
                "in_use",
                "temporarily_paused",
                "payment_issue",
                "ended",
                "needs_review",
                None,
            ],
        },
        "lifecycle_status": {
            "type": ["string", "null"],
            "enum": ["active", "unused", "used", "ended", "expired", "needs_review", None],
        },
        "auto_renewal_status": {
            "type": ["string", "null"],
            "enum": ["on", "off", "manual", "needs_review", None],
        },
        "usage_plan": {
            "type": ["string", "null"],
            "enum": ["scheduled", "ended", "needs_review", None],
        },
        "payment_method": {"type": ["string", "null"]},
        "category": {"type": ["string", "null"]},
        "memo": {"type": ["string", "null"]},
        "detected_fields": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "field": {"type": "string", "enum": list(EXTRACTABLE_FIELDS)},
                    "value": {"type": "string"},
                    "evidence": {"type": "string"},
                    "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                },
                "required": ["field", "value", "evidence", "confidence"],
            },
        },
        "missing_fields": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "string"},
    },
    "required": [
        "management_type",
        "service_name",
        "plan_name",
        "provider_name",
        "amount",
        "currency",
        "unit_name",
        "billing_cycle",
        "start_date_value",
        "start_date_precision",
        "target_date_value",
        "target_date_precision",
        "conditions",
        "actual_status",
        "lifecycle_status",
        "auto_renewal_status",
        "usage_plan",
        "payment_method",
        "category",
        "memo",
        "detected_fields",
        "missing_fields",
        "notes",
    ],
}


@dataclass(frozen=True, slots=True)
class ImageAsset:
    id: UUID
    user_id: UUID
    storage_path: str
    mime_type: str
    size_bytes: int
    original_keep: bool
    lifecycle_status: str
    analysis_status: str
    extraction_json: dict[str, Any]
    management_type: str
    original_status: str


def detect_mime(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in data[-64:]:
        return "image/png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP" and len(data) >= 16:
        return "image/webp"
    return None


def validate_image_bytes(data: bytes, declared_mime: str | None) -> str:
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise ApiError(413, "image_too_large", "이미지는 10MB 이하만 등록할 수 있어요.")
    detected = detect_mime(data)
    if detected is None or detected not in SUPPORTED_MIME_TYPES:
        raise ApiError(
            415, "unsupported_image", "손상되지 않은 JPEG, PNG, WebP 이미지만 등록할 수 있어요."
        )
    if declared_mime and declared_mime != detected:
        raise ApiError(415, "image_type_mismatch", "파일 확장자와 실제 이미지 형식이 달라요.")
    return detected


class ImageService:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    @property
    def supabase_headers(self) -> dict[str, str]:
        key = self.settings.supabase_publishable_key
        if not key:
            raise ApiError(503, "storage_not_configured", "이미지 저장 연결이 설정되지 않았어요.")
        return {"apikey": key, "Content-Type": "application/json"}

    def user_headers(self, user: CurrentUser) -> dict[str, str]:
        if not user.access_token:
            raise ApiError(401, "authentication_required", "로그인이 필요해요.")
        return {**self.supabase_headers, "Authorization": f"Bearer {user.access_token}"}

    def storage_delete_headers(self, user: CurrentUser) -> dict[str, str]:
        """Use server credentials after ownership was verified, with user RLS as fallback."""
        secret = self.settings.supabase_secret_key
        if secret:
            return {
                "apikey": secret,
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            }
        return self.user_headers(user)

    async def _request(
        self, method: str, url: str, *, headers: dict[str, str], **kwargs: Any
    ) -> httpx.Response:
        owns = self.client is None
        client = self.client or httpx.AsyncClient(timeout=30)
        try:
            return await client.request(method, url, headers=headers, **kwargs)
        except httpx.HTTPError as error:
            raise ApiError(
                503, "image_service_unavailable", "이미지 저장 서비스에 연결하지 못했어요."
            ) from error
        finally:
            if owns:
                await client.aclose()

    def base_url(self) -> str:
        if not self.settings.normalized_supabase_url:
            raise ApiError(503, "storage_not_configured", "이미지 저장 연결이 설정되지 않았어요.")
        return self.settings.normalized_supabase_url

    async def get_asset(self, user: CurrentUser, asset_id: UUID) -> ImageAsset:
        response = await self._request(
            "GET",
            f"{self.base_url()}/rest/v1/image_assets",
            headers=self.user_headers(user),
            params={
                "id": f"eq.{asset_id}",
                "user_id": f"eq.{user.id}",
                "select": "*",
                "limit": "1",
            },
        )
        if response.status_code != 200 or not response.json():
            raise ApiError(404, "image_not_found", "이미지를 찾지 못했어요.")
        data = response.json()[0]
        return ImageAsset(
            id=UUID(data["id"]),
            user_id=UUID(data["user_id"]),
            storage_path=data["storage_path"],
            mime_type=data["mime_type"],
            size_bytes=int(data["size_bytes"]),
            original_keep=bool(data["original_keep"]),
            lifecycle_status=data["lifecycle_status"],
            analysis_status=data["analysis_status"],
            extraction_json=data.get("extraction_json") or {},
            management_type=data["management_type"],
            original_status=data["original_status"],
        )

    async def signed_url(self, user: CurrentUser, asset_id: UUID) -> dict[str, Any]:
        asset = await self.get_asset(user, asset_id)
        secret = self.settings.supabase_secret_key
        if not secret:
            raise ApiError(
                503, "storage_not_configured", "이미지 미리보기 연결이 설정되지 않았어요."
            )
        path = quote(asset.storage_path, safe="/")
        response = await self._request(
            "POST",
            f"{self.base_url()}/storage/v1/object/sign/{BUCKET}/{path}",
            headers={
                "apikey": secret,
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            json={"expiresIn": 300},
        )
        if response.status_code not in (200, 201):
            raise ApiError(502, "image_preview_failed", "이미지 미리보기 주소를 만들지 못했어요.")
        result = response.json()
        signed = result.get("signedURL") or result.get("signedUrl")
        if not signed:
            raise ApiError(502, "image_preview_failed", "이미지 미리보기 주소가 비어 있어요.")
        return {
            "url": f"{self.base_url()}/storage/v1{signed}" if signed.startswith("/") else signed,
            "expires_in": 300,
        }

    async def analyze(self, user: CurrentUser, asset_id: UUID) -> dict[str, Any]:
        asset = await self.get_asset(user, asset_id)
        if asset.lifecycle_status != "active":
            raise ApiError(409, "image_not_active", "휴지통에 있는 이미지는 먼저 복원해 주세요.")
        if not self.settings.openai_api_key:
            raise ApiError(
                503, "openai_not_configured", "이미지 분석 연결이 아직 설정되지 않았어요."
            )
        start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        runs = await self._request(
            "GET",
            f"{self.base_url()}/rest/v1/image_analysis_runs",
            headers=self.user_headers(user),
            params={
                "user_id": f"eq.{user.id}",
                "created_at": f"gte.{start}",
                "select": "id,estimated_cost_usd,status",
            },
        )
        if runs.status_code != 200:
            raise ApiError(
                503, "analysis_limit_unavailable", "오늘 분석 사용량을 확인하지 못했어요."
            )
        run_rows = runs.json()
        estimated = float(self.settings.openai_estimated_cost_per_analysis_usd)
        if (
            len(run_rows) >= self.settings.openai_daily_analysis_limit
            or sum(float(row.get("estimated_cost_usd", 0)) for row in run_rows) + estimated
            > self.settings.openai_daily_cost_limit_usd
        ):
            raise ApiError(
                429,
                "analysis_limit_reached",
                "오늘 이미지 분석 한도에 도달했어요. 직접 등록은 계속 사용할 수 있어요.",
            )
        source = await self._request(
            "GET",
            f"{self.base_url()}/storage/v1/object/{BUCKET}/{quote(asset.storage_path, safe='/')}",
            headers=self.user_headers(user),
        )
        if source.status_code != 200:
            raise ApiError(
                502, "image_download_failed", "보관된 이미지를 분석 서비스로 전달하지 못했어요."
            )
        mime = validate_image_bytes(source.content, asset.mime_type)
        encoded = base64.b64encode(source.content).decode("ascii")
        run = await self._request(
            "POST",
            f"{self.base_url()}/rest/v1/image_analysis_runs",
            headers={**self.user_headers(user), "Prefer": "return=representation"},
            json={
                "user_id": str(user.id),
                "image_asset_id": str(asset.id),
                "status": "processing",
                "model": self.settings.openai_model,
                "estimated_cost_usd": estimated,
            },
        )
        if run.status_code not in (200, 201):
            raise ApiError(503, "analysis_run_unavailable", "이미지 분석 작업을 시작하지 못했어요.")
        await self._patch_asset(
            user, asset.id, {"analysis_status": "processing", "last_error_code": None}
        )
        try:
            response = await self._openai_request(encoded, mime, asset.management_type)
            message = response.get("choices", [{}])[0].get("message", {})
            if message.get("refusal"):
                await self._finish_run(user, asset.id, "refused", "model_refusal")
                raise ApiError(
                    422,
                    "analysis_refused",
                    "이미지 분석을 완료하지 못했어요. 직접 등록을 사용할 수 있어요.",
                )
            content = message.get("content")
            extraction = json.loads(content) if isinstance(content, str) else None
            if not isinstance(extraction, dict):
                raise ValueError("structured_output_missing")
            extraction = self._sanitize_extraction(extraction, asset.management_type)
        except ApiError:
            await self._patch_asset(
                user, asset.id, {"analysis_status": "failed", "last_error_code": "analysis_refused"}
            )
            raise
        except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError, ValueError) as error:
            await self._finish_run(user, asset.id, "failed", "analysis_failed")
            await self._patch_asset(
                user, asset.id, {"analysis_status": "failed", "last_error_code": "analysis_failed"}
            )
            raise ApiError(
                502,
                "analysis_failed",
                "이미지에서 확인 가능한 정보를 구조화하지 못했어요. "
                "직접 입력하거나 다시 시도해 주세요.",
            ) from error
        await self._finish_run(user, asset.id, "completed", None)
        updated = await self._patch_asset(
            user,
            asset.id,
            {
                "analysis_status": "ready",
                "extraction_json": extraction,
                "analysis_model": self.settings.openai_model,
                "last_activity_at": datetime.now(UTC).isoformat(),
            },
        )
        return {
            "asset": updated,
            "extraction": extraction,
            "model": self.settings.openai_model,
            "limit": {
                "daily_count": len(run_rows) + 1,
                "daily_limit": self.settings.openai_daily_analysis_limit,
            },
        }

    async def _openai_request(
        self, encoded: str, mime: str, management_type: str
    ) -> dict[str, Any]:
        prompt = (
            "Read only information visibly present in this image for the user-selected "
            f"management type `{management_type}`. Return the JSON schema exactly and return "
            "that selected management_type unchanged. Never guess values, prices, currencies, "
            "dates, categories, statuses, reminder choices, or user plans. Use null for every "
            "field that is unclear or absent. Add a field to detected_fields only when its value "
            "is visibly supported, and use the exact canonical field name from the schema. "
            "Preserve year-month dates as YYYY-MM with month precision and exact dates as "
            "YYYY-MM-DD with day precision; add both the date value field and its precision field "
            "to detected_fields. Date roles must remain distinct: an issue date or purchase date "
            "is not an expiry/renewal date, and must never be mapped to target_date_value. "
            "start_date_value may only contain a visible join, purchase, or coverage start date "
            "when that role fits the selected type. target_date_value may only contain a visible "
            "next billing, renewal, expiry, end, or warranty end date. A displayed product name "
            "does not imply a sale price. Do not extract or return email addresses, phone numbers, "
            "physical addresses, account IDs, membership codes, barcodes, or QR contents. "
            "Evidence must be a short description of visible text or layout, not sensitive data. "
            "The output is a draft for a user to review, never a confirmed record."
        )
        payload = {
            "model": self.settings.openai_model,
            "messages": [
                {"role": "system", "content": prompt},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"선택한 유형은 {management_type}입니다. "
                                "이 유형의 폼 필드에 해당하는 정보만 구조화해 주세요."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{encoded}", "detail": "low"},
                        },
                    ],
                },
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "image_extraction",
                    "strict": True,
                    "schema": EXTRACTION_SCHEMA,
                },
            },
            "temperature": 0,
        }
        owns = self.client is None
        client = self.client or httpx.AsyncClient(timeout=90)
        try:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if response.status_code >= 400:
                raise httpx.HTTPStatusError(
                    "OpenAI image analysis failed", request=response.request, response=response
                )
            return response.json()
        finally:
            if owns:
                await client.aclose()

    def _sanitize_extraction(
        self, extraction: dict[str, Any], management_type: str
    ) -> dict[str, Any]:
        sensitive = ("email", "phone", "address", "account", "member", "barcode", "qr", "code")
        for key in list(extraction):
            if any(token in key.lower() for token in sensitive):
                extraction.pop(key, None)
        extraction["detected_fields"] = [
            row
            for row in extraction.get("detected_fields", [])
            if row.get("field") in EXTRACTABLE_FIELDS
            and not any(token in str(row.get("field", "")).lower() for token in sensitive)
        ]
        detected = {row["field"] for row in extraction["detected_fields"]}
        for field in EXTRACTABLE_FIELDS:
            if field not in detected:
                extraction[field] = None
        extraction["management_type"] = management_type
        return extraction

    async def _finish_run(
        self, user: CurrentUser, asset_id: UUID, status: str, error_code: str | None
    ) -> None:
        await self._request(
            "PATCH",
            f"{self.base_url()}/rest/v1/image_analysis_runs",
            headers={**self.user_headers(user), "Prefer": "return=minimal"},
            params={
                "user_id": f"eq.{user.id}",
                "image_asset_id": f"eq.{asset_id}",
                "status": "eq.processing",
            },
            json={"status": status, "error_code": error_code},
        )

    async def _patch_asset(
        self,
        user: CurrentUser,
        asset_id: UUID,
        values: dict[str, Any],
        extra_params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        params = {"id": f"eq.{asset_id}", "user_id": f"eq.{user.id}", **(extra_params or {})}
        response = await self._request(
            "PATCH",
            f"{self.base_url()}/rest/v1/image_assets",
            headers={**self.user_headers(user), "Prefer": "return=representation"},
            params=params,
            json=values,
        )
        if response.status_code not in (200, 204):
            raise ApiError(503, "image_update_failed", "이미지 상태를 저장하지 못했어요.")
        return response.json()[0] if response.status_code == 200 and response.json() else values

    async def change_lifecycle(
        self, user: CurrentUser, asset_id: UUID, action: str
    ) -> dict[str, Any]:
        asset = await self.get_asset(user, asset_id)
        now = datetime.now(UTC)
        if action == "trash":
            if asset.lifecycle_status not in ("active", "failed"):
                raise ApiError(
                    409, "image_state_conflict", "현재 이미지 상태에서는 휴지통으로 옮길 수 없어요."
                )
            return await self._patch_asset(
                user,
                asset_id,
                {
                    "lifecycle_status": "trash",
                    "trashed_at": now.isoformat(),
                    "purge_after": (now + timedelta(days=30)).isoformat(),
                    "last_error_code": None,
                },
                {"lifecycle_status": f"in.({','.join(['active', 'failed'])})"},
            )
        if action == "restore":
            if asset.lifecycle_status != "trash":
                raise ApiError(
                    409, "image_state_conflict", "휴지통에 있는 이미지만 복원할 수 있어요."
                )
            return await self._patch_asset(
                user,
                asset_id,
                {
                    "lifecycle_status": "active",
                    "trashed_at": None,
                    "purge_after": None,
                    "last_error_code": None,
                },
                {"lifecycle_status": "eq.trash"},
            )
        if action in ("delete", "retry"):
            if action == "delete" and asset.lifecycle_status not in ("trash", "failed"):
                raise ApiError(409, "image_state_conflict", "이미지를 먼저 휴지통으로 옮겨 주세요.")
            return await self._purge(user, asset)
        raise ApiError(400, "invalid_image_action", "지원하지 않는 이미지 상태 변경이에요.")

    async def _purge(self, user: CurrentUser, asset: ImageAsset) -> dict[str, Any]:
        response = await self._request(
            "DELETE",
            f"{self.base_url()}/storage/v1/object/{BUCKET}/{quote(asset.storage_path, safe='/')}",
            headers=self.storage_delete_headers(user),
        )
        if response.status_code not in (200, 204, 404):
            await self._patch_asset(
                user,
                asset.id,
                {"lifecycle_status": "failed", "last_error_code": "storage_delete_failed"},
            )
            raise ApiError(
                502, "image_delete_failed", "이미지 삭제에 실패했어요. 재시도할 수 있어요."
            )
        return await self._patch_asset(
            user,
            asset.id,
            {
                "lifecycle_status": "deleted",
                "original_status": "deleted",
                "original_deleted_at": datetime.now(UTC).isoformat(),
                "trashed_at": None,
                "purge_after": None,
                "last_error_code": None,
            },
        )

    async def confirm(
        self, user: CurrentUser, asset_id: UUID, item_id: UUID | None, original_keep: bool
    ) -> dict[str, Any]:
        asset = await self.get_asset(user, asset_id)
        values: dict[str, Any] = {
            "item_id": str(item_id) if item_id else None,
            "original_keep": original_keep,
            "confirmed_at": datetime.now(UTC).isoformat(),
            "last_activity_at": datetime.now(UTC).isoformat(),
        }
        if not original_keep:
            response = await self._request(
                "DELETE",
                f"{self.base_url()}/storage/v1/object/{BUCKET}/"
                f"{quote(asset.storage_path, safe='/')}",
                headers=self.storage_delete_headers(user),
            )
            if response.status_code not in (200, 204, 404):
                values["original_status"] = "pending_delete"
                values["last_error_code"] = "original_delete_failed"
                await self._patch_asset(user, asset_id, values)
                raise ApiError(
                    502,
                    "original_delete_failed",
                    "확정 정보는 저장했지만 원본 삭제에 실패했어요. "
                    "이미지에서 다시 재시도할 수 있어요.",
                )
            values["original_status"] = "deleted"
            values["original_deleted_at"] = datetime.now(UTC).isoformat()
        return await self._patch_asset(user, asset_id, values)


def get_image_service(settings: Annotated[Settings, Depends(get_settings)]) -> ImageService:
    return ImageService(settings)
