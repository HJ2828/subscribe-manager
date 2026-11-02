from typing import Annotated
from uuid import UUID

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.account_deletion import AccountDeletionService, get_account_deletion_service
from app.config import Settings, get_settings
from app.errors import ApiError, api_error_handler
from app.image_service import ImageService, get_image_service
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

    return app


app = create_app()
