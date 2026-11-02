from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.errors import ApiError


@dataclass(frozen=True, slots=True)
class DeletionResult:
    request_id: UUID
    status: str = "completed"


class AccountDeletionService:
    """Coordinates deletion while keeping a server-only retry record.

    Profiles and current Phase 1 placeholder items are removed by their
    ``auth.users`` foreign-key cascades. Later phases can add storage,
    notification, and interest cleanup steps in ``run_pre_auth_cleanup_steps``.
    """

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    @property
    def headers(self) -> dict[str, str]:
        secret = self.settings.supabase_secret_key
        if not secret:
            raise ApiError(
                503,
                "account_deletion_not_configured",
                "회원 탈퇴 처리가 아직 설정되지 않았습니다. 잠시 후 다시 시도해 주세요.",
            )
        return {
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
        }

    async def delete(self, user_id: UUID) -> DeletionResult:
        base_url = self.settings.normalized_supabase_url
        if not base_url:
            raise ApiError(
                503,
                "account_deletion_not_configured",
                "회원 탈퇴 처리가 아직 설정되지 않았습니다. 잠시 후 다시 시도해 주세요.",
            )

        owns_client = self.client is None
        client = self.client or httpx.AsyncClient(timeout=15)
        try:
            request_id = await self._create_request(client, base_url, user_id)
            await self.run_pre_auth_cleanup_steps(user_id)
            response = await client.delete(
                f"{base_url}/auth/v1/admin/users/{user_id}",
                headers=self.headers,
            )
            if response.status_code not in (200, 204):
                await self._mark_retry_pending(client, base_url, request_id)
                raise ApiError(
                    502,
                    "account_deletion_failed",
                    "회원 탈퇴를 완료하지 못했습니다. 계정은 유지되며 다시 시도할 수 있습니다.",
                )

            # The account is already inaccessible at this point. A tracking
            # update failure must not turn a completed deletion into a failure UI.
            await self._mark_completed(client, base_url, request_id)
            return DeletionResult(request_id=request_id)
        finally:
            if owns_client:
                await client.aclose()

    async def run_pre_auth_cleanup_steps(self, _: UUID) -> None:
        """Extension point for Phase 4+ resources that do not cascade from Auth."""

    async def _create_request(
        self, client: httpx.AsyncClient, base_url: str, user_id: UUID
    ) -> UUID:
        response = await client.post(
            f"{base_url}/rest/v1/account_deletion_requests",
            headers={**self.headers, "Prefer": "return=representation"},
            json={"user_id": str(user_id), "status": "processing"},
        )
        if response.status_code not in (200, 201):
            raise ApiError(
                503,
                "account_deletion_unavailable",
                "회원 탈퇴 요청을 시작하지 못했습니다. 계정은 변경되지 않았습니다.",
            )
        try:
            return UUID(response.json()[0]["id"])
        except (KeyError, TypeError, ValueError, IndexError) as error:
            raise ApiError(
                503,
                "account_deletion_unavailable",
                "회원 탈퇴 요청을 시작하지 못했습니다. 계정은 변경되지 않았습니다.",
            ) from error

    async def _mark_retry_pending(
        self, client: httpx.AsyncClient, base_url: str, request_id: UUID
    ) -> None:
        try:
            await client.patch(
                f"{base_url}/rest/v1/account_deletion_requests?id=eq.{request_id}",
                headers=self.headers,
                json={"status": "retry_pending", "last_error_code": "auth_delete_failed"},
            )
        except httpx.HTTPError:
            return

    async def _mark_completed(
        self, client: httpx.AsyncClient, base_url: str, request_id: UUID
    ) -> None:
        try:
            await client.patch(
                f"{base_url}/rest/v1/account_deletion_requests?id=eq.{request_id}",
                headers=self.headers,
                json={
                    "status": "completed",
                    "completed_at": datetime.now(UTC).isoformat(),
                    "last_error_code": None,
                },
            )
        except httpx.HTTPError:
            # The account deletion itself succeeded. The processing row remains
            # visible to an operations retry/reconciliation job added later.
            return


def get_account_deletion_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> AccountDeletionService:
    return AccountDeletionService(settings)
