import asyncio
from datetime import UTC, datetime, timedelta

import httpx

from app.config import Settings
from app.unverified_account_cleanup import UnverifiedAccountCleanupService


class FakeClient:
    def __init__(self, users: list[dict[str, object]]) -> None:
        self.users = users
        self.deleted: list[str] = []

    async def get(self, url: str, **_: object) -> httpx.Response:
        request = httpx.Request("GET", url)
        return httpx.Response(200, request=request, json={"users": self.users})

    async def delete(self, url: str, **_: object) -> httpx.Response:
        user_id = url.rsplit("/", 1)[-1]
        self.deleted.append(user_id)
        request = httpx.Request("DELETE", url)
        return httpx.Response(204, request=request)


def test_cleanup_deletes_only_old_unverified_users() -> None:
    old = (datetime.now(UTC) - timedelta(days=8)).isoformat()
    client = FakeClient(
        [
            {"id": "old", "created_at": old, "email_confirmed_at": None},
            {"id": "confirmed", "created_at": old, "email_confirmed_at": old},
            {"id": "new", "created_at": datetime.now(UTC).isoformat(), "email_confirmed_at": None},
        ]
    )
    service = UnverifiedAccountCleanupService(
        Settings(
            supabase_url="https://project.example",
            supabase_secret_key="server-only-secret",
            unverified_account_retention_days=7,
        ),
        client=client,  # type: ignore[arg-type]
    )

    result = asyncio.run(service.cleanup())

    assert result.scanned == 3
    assert result.deleted == 1
    assert result.skipped == 2
    assert client.deleted == ["old"]
