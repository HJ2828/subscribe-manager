from typing import Annotated, Literal
from urllib.parse import quote, urlparse
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.account_deletion import AccountDeletionService, get_account_deletion_service
from app.config import Settings, get_settings
from app.content_service import ContentService, get_content_service
from app.errors import ApiError, api_error_handler
from app.image_service import ImageService, get_image_service
from app.notification_service import NotificationService, get_notification_service
from app.security import CurrentUser, require_current_user
from app.unverified_account_cleanup import (
    UnverifiedAccountCleanupService,
    get_unverified_account_cleanup_service,
)


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or get_settings()
    app = FastAPI(title="subscribe-manager API", version="0.1.0")
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "environment": active_settings.app_environment}

    @app.get("/api/v1/brands/search", tags=["brands"])
    async def search_brands(
        q: str,
        _: Annotated[CurrentUser, Depends(require_current_user)],
    ) -> dict[str, list[dict[str, str | None]]]:
        query = q.strip()
        if not query or len(query) > 120 or not active_settings.brandfetch_client_id:
            return {"candidates": []}
        params = {"c": active_settings.brandfetch_client_id}
        headers = {"Accept": "application/json"}
        if active_settings.brandfetch_api_key:
            headers["Authorization"] = f"Bearer {active_settings.brandfetch_api_key}"
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(
                    f"https://api.brandfetch.io/v2/search/{quote(query, safe='')}",
                    params=params,
                    headers=headers,
                )
        except httpx.HTTPError:
            return {"candidates": []}
        if response.status_code >= 400:
            return {"candidates": []}
        body = response.json()
        rows = body if isinstance(body, list) else body.get("results", []) if isinstance(body, dict) else []
        candidates: list[dict[str, str | None]] = []
        seen: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            domain = str(row.get("domain") or "").strip().lower()
            if not domain:
                url = str(row.get("url") or "").strip()
                domain = urlparse(url if "://" in url else f"https://{url}").hostname or ""
            domain = domain.removeprefix("www.")
            if not domain or domain in seen:
                continue
            seen.add(domain)
            logo = f"https://cdn.brandfetch.io/domain/{domain}"
            if active_settings.brandfetch_client_id:
                logo = f"{logo}?c={quote(active_settings.brandfetch_client_id, safe='')}"
            candidates.append({"domain": domain, "name": str(row.get("name") or domain), "logo_url": logo})
        return {"candidates": candidates[:5]}

    @app.get("/api/v1/me", tags=["account"])
    async def me(user: Annotated[CurrentUser, Depends(require_current_user)]) -> dict[str, str]:
        return {"user_id": str(user.id)}

    @app.delete("/api/v1/account", tags=["account"])
    async def delete_account(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        deletion_service: Annotated[AccountDeletionService, Depends(get_account_deletion_service)],
    ) -> dict[str, str]:
        result = await deletion_service.delete(user.id)
        return {"status": result.status, "request_id": str(result.request_id)}

    @app.get("/api/v1/images/{asset_id}/signed-url", tags=["images"])
    async def image_signed_url(
        asset_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return await image_service.signed_url(user, asset_id)

    @app.post("/api/v1/images/{asset_id}/analyze", tags=["images"])
    async def analyze_image(
        asset_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return await image_service.analyze(user, asset_id)

    @app.post("/api/v1/images/{asset_id}/trash", tags=["images"])
    async def trash_image(
        asset_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return {"asset": await image_service.change_lifecycle(user, asset_id, "trash")}

    @app.post("/api/v1/images/{asset_id}/restore", tags=["images"])
    async def restore_image(
        asset_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return {"asset": await image_service.change_lifecycle(user, asset_id, "restore")}

    @app.post("/api/v1/images/{asset_id}/delete", tags=["images"])
    async def delete_image(
        asset_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return {"asset": await image_service.change_lifecycle(user, asset_id, "delete")}

    @app.post("/api/v1/images/{asset_id}/retry", tags=["images"])
    async def retry_image_delete(
        asset_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return {"asset": await image_service.change_lifecycle(user, asset_id, "retry")}

    class ConfirmImageRequest(BaseModel):
        item_id: UUID | None = None
        original_keep: bool

    @app.post("/api/v1/images/{asset_id}/confirm", tags=["images"])
    async def confirm_image(
        asset_id: UUID,
        body: ConfirmImageRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        image_service: Annotated[ImageService, Depends(get_image_service)],
    ) -> dict[str, object]:
        return {
            "asset": await image_service.confirm(user, asset_id, body.item_id, body.original_keep)
        }

    class PushSubscriptionRequest(BaseModel):
        endpoint: str
        keys: dict[str, str]

    class PushUnsubscribeRequest(BaseModel):
        endpoint: str

    class CatalogRequest(BaseModel):
        display_name: str
        match_names: list[str] = []
        news_support_status: str = "collecting"
        cancellation_support_status: str = "collecting"

    class CatalogCollectionRequest(BaseModel):
        enabled: bool

    class CollectionSettingsRequest(BaseModel):
        enabled: bool
        interval_hours: int

    class CancellationGuideRequest(BaseModel):
        catalog_id: UUID
        payment_path: str
        country_code: str = "KR"
        plan_scope: str | None = None
        title: str
        steps: list[str]
        conditions: str | None = None
        access_after_cancel: str | None = None
        source_title: str
        source_url: str
        source_domain: str
        checked_at: str
        status: Literal["draft", "pending_review"] = "pending_review"

    class NewsRequest(BaseModel):
        catalog_id: UUID
        news_type: Literal["content", "feature", "limit", "price", "benefit", "ending", "other"]
        title: str
        summary: str
        source_title: str
        source_url: str
        source_domain: str
        announced_on: str | None = None
        applies_on: str | None = None
        country_codes: list[str] = []
        plan_scopes: list[str] = []
        conditions: str | None = None
        impact_summary: str | None = None
        applicability_status: Literal["confirmed", "needs_confirmation"] = "needs_confirmation"
        checked_at: str
        status: Literal["draft", "pending_review"] = "pending_review"

    class ContentReviewRequest(BaseModel):
        status: str
        reason: str

    class CollectionRunRequest(BaseModel):
        catalog_id: UUID | None = None
        content_kind: Literal["news", "cancellation"]
        outcome: Literal[
            "new_content",
            "no_new_content",
            "search_failed",
            "source_failed",
            "conditions_unconfirmed",
            "budget_limited",
        ]
        details: str | None = None

    class AnnouncementRequest(BaseModel):
        title: str
        body: str

    class AnnouncementReviewRequest(BaseModel):
        status: Literal["published", "hidden"]

    @app.get("/api/v1/push/config", tags=["notifications"])
    async def push_config(
        _: Annotated[CurrentUser, Depends(require_current_user)],
    ) -> dict[str, object]:
        return {
            "configured": bool(
                active_settings.vapid_public_key and active_settings.vapid_private_key
            ),
            "public_key": active_settings.vapid_public_key,
        }

    @app.post("/api/v1/push/subscriptions", tags=["notifications"])
    async def register_push_subscription(
        body: PushSubscriptionRequest,
        request: Request,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[NotificationService, Depends(get_notification_service)],
    ) -> dict[str, str]:
        await service.register(user, body.model_dump(), request.headers.get("user-agent"))
        return {"status": "registered"}

    @app.post("/api/v1/push/unsubscribe", tags=["notifications"])
    async def unregister_push_subscription(
        body: PushUnsubscribeRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[NotificationService, Depends(get_notification_service)],
    ) -> dict[str, object]:
        remaining = await service.unregister(user, body.endpoint)
        return {"status": "unregistered", "push_enabled": remaining}

    @app.post("/api/v1/notifications/process", tags=["notifications"])
    async def process_notifications(
        service: Annotated[NotificationService, Depends(get_notification_service)],
        x_cron_secret: Annotated[str | None, Header()] = None,
    ) -> dict[str, int]:
        if (
            not active_settings.notification_cron_secret
            or x_cron_secret != active_settings.notification_cron_secret
        ):
            raise ApiError(401, "invalid_cron_secret", "알림 작업 실행 권한이 없습니다.")
        result = await service.process_due()
        return {
            "processed": result.processed,
            "sent": result.sent,
            "failed": result.failed,
            "unknown": result.unknown,
            "skipped": result.skipped,
            "delayed": result.delayed,
        }

    @app.post("/api/v1/auth/cleanup-unverified", tags=["auth"])
    async def cleanup_unverified_accounts(
        service: Annotated[
            UnverifiedAccountCleanupService,
            Depends(get_unverified_account_cleanup_service),
        ],
        x_cron_secret: Annotated[str | None, Header()] = None,
    ) -> dict[str, int]:
        if (
            not active_settings.unverified_account_cleanup_cron_secret
            or x_cron_secret != active_settings.unverified_account_cleanup_cron_secret
        ):
            raise ApiError(401, "invalid_cron_secret", "계정 정리 작업 실행 권한이 없습니다.")
        result = await service.cleanup()
        return {
            "scanned": result.scanned,
            "deleted": result.deleted,
            "skipped": result.skipped,
        }

    @app.get("/api/v1/content/operator-status", tags=["content"])
    async def content_operator_status(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, bool]:
        return await service.operator_status(user)

    @app.get("/api/v1/content/news", tags=["content"])
    async def relevant_news(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> list[dict[str, object]]:
        return await service.news_for_user(user)

    @app.get("/api/v1/content/collection-status", tags=["content"])
    async def collection_status(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.collection_status(user)

    @app.get("/api/v1/content/scraps", tags=["content"])
    async def news_scraps(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> list[dict[str, object]]:
        return await service.scraps_for_user(user)

    @app.get("/api/v1/content/ott-news", tags=["content"])
    async def ott_news(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> list[dict[str, object]]:
        return await service.ott_news_for_user(user)

    @app.post("/api/v1/content/news/{news_id}/scrap", tags=["content"])
    async def add_news_scrap(
        news_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.add_scrap(user, news_id)

    @app.delete("/api/v1/content/news/{news_id}/scrap", tags=["content"])
    async def remove_news_scrap(
        news_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.remove_scrap(user, news_id)

    @app.get("/api/v1/content/announcements", tags=["content"])
    async def announcements(
        _: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> list[dict[str, object]]:
        return await service.announcements()

    @app.post("/api/v1/content/process", tags=["content"])
    async def process_content(
        service: Annotated[ContentService, Depends(get_content_service)],
        x_cron_secret: Annotated[str | None, Header()] = None,
        scope: Annotated[str | None, Query()] = None,
    ) -> dict[str, int]:
        if (
            not active_settings.content_collection_cron_secret
            or x_cron_secret != active_settings.content_collection_cron_secret
        ):
            raise ApiError(401, "invalid_cron_secret", "자동 소식 수집 실행 권한이 없습니다.")
        return await service.process_due_news(scope)

    @app.get("/api/v1/content/items/{item_id}", tags=["content"])
    async def item_content(
        item_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.item_content(user, item_id)

    @app.get("/api/v1/operations/content", tags=["operations"])
    async def content_review_data(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.review_data(user)

    @app.post("/api/v1/operations/catalogs", tags=["operations"])
    async def create_catalog(
        body: CatalogRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.create_catalog(user, body.model_dump())

    @app.patch("/api/v1/operations/catalogs/{catalog_id}/collection", tags=["operations"])
    async def set_catalog_collection(
        catalog_id: UUID,
        body: CatalogCollectionRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.set_catalog_collection_enabled(user, str(catalog_id), body.enabled)

    @app.delete("/api/v1/operations/catalogs/{catalog_id}", tags=["operations"])
    async def delete_catalog(
        catalog_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.delete_catalog(user, str(catalog_id))

    @app.patch("/api/v1/operations/collection-settings", tags=["operations"])
    async def update_collection_settings(
        body: CollectionSettingsRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.update_collection_settings(user, body.enabled, body.interval_hours)

    @app.post("/api/v1/operations/cancellation-guides", tags=["operations"])
    async def create_cancellation_guide(
        body: CancellationGuideRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.create_content(user, "cancellation_guide", body.model_dump())

    @app.post("/api/v1/operations/news", tags=["operations"])
    async def create_news(
        body: NewsRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.create_content(user, "news", body.model_dump())

    @app.post("/api/v1/operations/collection-runs", tags=["operations"])
    async def create_collection_run(
        body: CollectionRunRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.record_collection_run(user, body.model_dump())

    @app.post("/api/v1/operations/announcements", tags=["operations"])
    async def create_announcement(
        body: AnnouncementRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.create_announcement(user, body.title, body.body)

    @app.patch("/api/v1/operations/announcements/{announcement_id}", tags=["operations"])
    async def review_announcement(
        announcement_id: UUID,
        body: AnnouncementReviewRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.review_announcement(user, announcement_id, body.status, "운영자 상태 변경")

    @app.delete("/api/v1/operations/announcements/{announcement_id}", tags=["operations"])
    async def delete_announcement(
        announcement_id: UUID,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.delete_announcement(user, announcement_id)

    @app.patch("/api/v1/operations/{entity}/{entity_id}/review", tags=["operations"])
    async def review_content(
        entity: Literal["cancellation_guide", "news"],
        entity_id: UUID,
        body: ContentReviewRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[ContentService, Depends(get_content_service)],
    ) -> dict[str, object]:
        return await service.review(user, entity, entity_id, body.status, body.reason)

    return app


app = create_app()
