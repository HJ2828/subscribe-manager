from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.errors import ApiError


@dataclass(frozen=True, slots=True)
class CleanupResult:
    scanned: int
    deleted: int
    skipped: int


class UnverifiedAccountCleanupService:
    """Deletes old Supabase Auth users who never confirmed their email."""

    page_size = 100

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    @property
    def headers(self) -> dict[str, str]:
        secret = self.settings.supabase_secret_key
        if not secret:
            raise ApiError(
                503, "account_cleanup_not_configured", "계정 정리 작업이 설정되지 않았습니다."
            )
        return {
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        }

    async def cleanup(self) -> CleanupResult:
        base_url = self.settings.normalized_supabase_url
        retention_days = self.settings.unverified_account_retention_days
        if not base_url or retention_days <= 0:
            raise ApiError(
                503, "account_cleanup_not_configured", "계정 정리 작업이 설정되지 않았습니다."
            )

        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=15)
        cutoff = datetime.now(UTC) - timedelta(days=retention_days)
        scanned = deleted = skipped = 0
        page = 1
        try:
            while True:
                users = await self._list_users(client, base_url, page)
                if not users:
                    break
                for user in users:
                    scanned += 1
                    if not self._is_expired_unverified_user(user, cutoff):
                        skipped += 1
                        continue
                    if await self._delete_user(client, base_url, str(user.get("id", ""))):
                        deleted += 1
                    else:
                        skipped += 1
                if len(users) < self.page_size:
                    break
                page += 1
            return CleanupResult(scanned=scanned, deleted=deleted, skipped=skipped)
        finally:
            if owns_client:
                await client.aclose()

    async def _list_users(
        self, client: httpx.AsyncClient, base_url: str, page: int
    ) -> list[dict[str, Any]]:
        response = await client.get(
            f"{base_url}/auth/v1/admin/users",
            headers=self.headers,
            params={"page": page, "per_page": self.page_size},
        )
        if response.status_code != 200:
            raise ApiError(502, "account_cleanup_failed", "미인증 계정 목록을 조회하지 못했습니다.")
        body = response.json()
        users = body.get("users", []) if isinstance(body, dict) else body
        if not isinstance(users, list):
            raise ApiError(
                502, "account_cleanup_failed", "미인증 계정 목록 응답이 올바르지 않습니다."
            )
        return [user for user in users if isinstance(user, dict)]

    async def _delete_user(self, client: httpx.AsyncClient, base_url: str, user_id: str) -> bool:
        if not user_id:
            return False
        response = await client.delete(
            f"{base_url}/auth/v1/admin/users/{user_id}",
            headers=self.headers,
        )
        return response.status_code in (200, 204)

    @staticmethod
    def _is_expired_unverified_user(user: dict[str, Any], cutoff: datetime) -> bool:
        if user.get("email_confirmed_at") or user.get("confirmed_at"):
            return False
        created_at = user.get("created_at")
        if not isinstance(created_at, str):
            return False
        try:
            created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        if created.tzinfo is None:
            created = created.replace(tzinfo=UTC)
        return created < cutoff


def get_unverified_account_cleanup_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> UnverifiedAccountCleanupService:
    return UnverifiedAccountCleanupService(settings)
