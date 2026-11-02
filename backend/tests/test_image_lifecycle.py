import asyncio
import json
from uuid import UUID

import httpx

from app.config import Settings
from app.image_service import ImageAsset, ImageService
from app.security import CurrentUser

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
ASSET_ID = UUID("22222222-2222-2222-2222-222222222222")


def test_permanent_delete_uses_server_storage_permission_and_clears_trash_dates() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.method == "DELETE":
            return httpx.Response(204)
        body = json.loads(request.content)
        return httpx.Response(200, json=[body])

    async def run() -> dict[str, object]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = ImageService(
                Settings(
                    supabase_url="https://project.example",
                    supabase_publishable_key="public-test-value",
                    supabase_secret_key="server-test-value",
                ),
                client,
            )
            return await service._purge(
                CurrentUser(USER_ID, "user-access-token"),
                ImageAsset(
                    id=ASSET_ID,
                    user_id=USER_ID,
                    storage_path=f"{USER_ID}/receipt.png",
                    mime_type="image/png",
                    size_bytes=1024,
                    original_keep=True,
                    lifecycle_status="trash",
                    analysis_status="ready",
                    extraction_json={},
                    management_type="gifticon",
                    original_status="kept",
                ),
            )

    result = asyncio.run(run())

    delete_request = next(request for request in calls if request.method == "DELETE")
    assert delete_request.headers["authorization"] == "Bearer server-test-value"
    assert result["lifecycle_status"] == "deleted"
    assert result["original_status"] == "deleted"
    assert result["trashed_at"] is None
    assert result["purge_after"] is None


def test_storage_delete_falls_back_to_user_permission_without_server_key() -> None:
    service = ImageService(
        Settings(
            supabase_url="https://project.example",
            supabase_publishable_key="public-test-value",
            supabase_secret_key=None,
        )
    )

    headers = service.storage_delete_headers(CurrentUser(USER_ID, "user-access-token"))

    assert headers["apikey"] == "public-test-value"
    assert headers["Authorization"] == "Bearer user-access-token"
