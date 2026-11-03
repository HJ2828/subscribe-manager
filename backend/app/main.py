from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.account_deletion import AccountDeletionService, get_account_deletion_service
from app.config import Settings, get_settings
from app.errors import ApiError, api_error_handler
from app.google_calendar_service import GoogleCalendarService, get_google_calendar_service
from app.image_service import ImageService, get_image_service
from app.notification_service import NotificationService, get_notification_service
from app.security import CurrentUser, require_current_user


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

    @app.get("/api/v1/me", tags=["account"])
    async def me(user: Annotated[CurrentUser, Depends(require_current_user)]) -> dict[str, str]:
        return {"user_id": str(user.id)}

    @app.delete("/api/v1/account", tags=["account"])
    async def delete_account(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        deletion_service: Annotated[AccountDeletionService, Depends(get_account_deletion_service)],
        google_service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
    ) -> dict[str, str]:
        try:
            await google_service.disconnect(user, delete_events=True)
        except ApiError:
            # Google cleanup is best-effort and must not restore or block internal account deletion.
            pass
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

    class GoogleEventTypesRequest(BaseModel):
        event_types: list[str]

    class GoogleDisconnectRequest(BaseModel):
        delete_events: bool

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

    @app.get("/api/v1/google-calendar/status", tags=["google-calendar"])
    async def google_calendar_status(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
    ) -> dict[str, object]:
        return await service.status(user)

    @app.post("/api/v1/google-calendar/connect", tags=["google-calendar"])
    async def google_calendar_connect(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
    ) -> dict[str, str]:
        return {"authorization_url": await service.authorization_url(user)}

    @app.get("/api/v1/google-calendar/callback", tags=["google-calendar"])
    async def google_calendar_callback(
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
        code: str | None = None,
        state: str | None = None,
        error: str | None = None,
    ) -> RedirectResponse:
        frontend = active_settings.frontend_app_url.rstrip("/")
        if error or not code or not state:
            return RedirectResponse(f"{frontend}/settings?google_calendar=denied", status_code=303)
        try:
            await service.complete_oauth(code, state)
        except ApiError:
            return RedirectResponse(f"{frontend}/settings?google_calendar=failed", status_code=303)
        return RedirectResponse(f"{frontend}/settings?google_calendar=connected", status_code=303)

    @app.post("/api/v1/google-calendar/sync", tags=["google-calendar"])
    async def google_calendar_sync(
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
    ) -> dict[str, int]:
        result = await service.sync_user(user.id)
        return {
            "created": result.created,
            "updated": result.updated,
            "deleted": result.deleted,
            "failed": result.failed,
        }

    @app.patch("/api/v1/google-calendar/event-types", tags=["google-calendar"])
    async def google_calendar_event_types(
        body: GoogleEventTypesRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
    ) -> dict[str, int]:
        result = await service.update_event_types(user, body.event_types)
        return {
            "created": result.created,
            "updated": result.updated,
            "deleted": result.deleted,
            "failed": result.failed,
        }

    @app.post("/api/v1/google-calendar/disconnect", tags=["google-calendar"])
    async def google_calendar_disconnect(
        body: GoogleDisconnectRequest,
        user: Annotated[CurrentUser, Depends(require_current_user)],
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
    ) -> dict[str, int | str]:
        result = await service.disconnect(user, body.delete_events)
        return {"status": "disconnected", "deleted": result.deleted, "failed": result.failed}

    @app.post("/api/v1/google-calendar/process", tags=["google-calendar"])
    async def google_calendar_process(
        service: Annotated[GoogleCalendarService, Depends(get_google_calendar_service)],
        x_cron_secret: Annotated[str | None, Header()] = None,
    ) -> dict[str, int]:
        if (
            not active_settings.google_calendar_cron_secret
            or x_cron_secret != active_settings.google_calendar_cron_secret
        ):
            raise ApiError(
                401, "invalid_cron_secret", "Google Calendar 동기화 실행 권한이 없습니다."
            )
        return await service.process_all()

    return app


app = create_app()
