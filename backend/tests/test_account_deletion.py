import asyncio
from uuid import UUID

import httpx
import pytest

from app.account_deletion import AccountDeletionService
from app.config import Settings
from app.errors import ApiError

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
REQUEST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


def test_deletion_records_request_then_deletes_auth_user_and_completes() -> None:
    calls: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "POST":
            return httpx.Response(201, json=[{"id": REQUEST_ID}])
        return httpx.Response(200, json={})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = AccountDeletionService(
                Settings(
                    supabase_url="https://project.example",
                    supabase_publishable_key="public-test-value",
                    supabase_secret_key="server-test-value",
                ),
                client,
            )
            return await service.delete(USER_ID)

    result = asyncio.run(run())

    assert str(result.request_id) == REQUEST_ID
    assert calls == [
        ("POST", "/rest/v1/account_deletion_requests"),
        ("DELETE", f"/auth/v1/admin/users/{USER_ID}"),
        ("PATCH", "/rest/v1/account_deletion_requests"),
    ]


def test_failed_auth_deletion_is_marked_for_retry() -> None:
    patches = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal patches
        if request.method == "POST":
            return httpx.Response(201, json=[{"id": REQUEST_ID}])
        if request.method == "DELETE":
            return httpx.Response(500, json={})
        patches += 1
        return httpx.Response(204)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            service = AccountDeletionService(
                Settings(
                    supabase_url="https://project.example",
                    supabase_publishable_key="public-test-value",
                    supabase_secret_key="server-test-value",
                ),
                client,
            )
            await service.delete(USER_ID)

    with pytest.raises(ApiError) as caught:
        asyncio.run(run())

    assert caught.value.code == "account_deletion_failed"
    assert patches == 1
