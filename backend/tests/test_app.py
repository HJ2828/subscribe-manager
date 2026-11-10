from uuid import UUID

from fastapi.testclient import TestClient

from app.account_deletion import DeletionResult, get_account_deletion_service
from app.config import Settings, get_settings
from app.errors import ApiError
from app.main import app, create_app
from app.security import CurrentUser, require_current_user
from app.unverified_account_cleanup import CleanupResult, get_unverified_account_cleanup_service

client = TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def test_health_does_not_require_authentication() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_protected_route_requires_bearer_token() -> None:
    response = client.get("/api/v1/me")

    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "authentication_required", "message": "로그인이 필요합니다."}
    }


def test_protected_route_reports_missing_external_configuration_without_leaking_values() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url=None,
        supabase_publishable_key=None,
    )

    response = client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "authentication_not_configured"
    assert "not-a-real-token" not in response.text


class SuccessfulDeletionService:
    async def delete(self, user_id: UUID) -> DeletionResult:
        assert user_id == UUID("11111111-1111-1111-1111-111111111111")
        return DeletionResult(UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"))


class FailedDeletionService:
    async def delete(self, _: UUID) -> DeletionResult:
        raise ApiError(
            502,
            "account_deletion_failed",
            "회원 탈퇴를 완료하지 못했습니다. 계정은 유지되며 다시 시도할 수 있습니다.",
        )


def override_user() -> CurrentUser:
    return CurrentUser(UUID("11111111-1111-1111-1111-111111111111"))


def test_account_deletion_returns_completion_only_after_service_success() -> None:
    app.dependency_overrides[require_current_user] = override_user
    app.dependency_overrides[get_account_deletion_service] = SuccessfulDeletionService

    response = client.delete("/api/v1/account")

    assert response.status_code == 200
    assert response.json() == {
        "status": "completed",
        "request_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    }


def test_account_deletion_failure_does_not_return_completion() -> None:
    app.dependency_overrides[require_current_user] = override_user
    app.dependency_overrides[get_account_deletion_service] = FailedDeletionService

    response = client.delete("/api/v1/account")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "account_deletion_failed"


def test_push_config_requires_authentication() -> None:
    response = client.get("/api/v1/push/config")
    assert response.status_code == 401


def test_push_config_does_not_expose_private_key() -> None:
    app.dependency_overrides[require_current_user] = override_user
    response = client.get("/api/v1/push/config")
    assert response.status_code == 200
    assert set(response.json()) == {"configured", "public_key"}
    assert "private" not in response.text.lower()


def test_notification_worker_rejects_missing_cron_secret() -> None:
    response = client.post("/api/v1/notifications/process")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_cron_secret"


def test_content_worker_rejects_missing_cron_secret() -> None:
    response = client.post("/api/v1/content/process")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_cron_secret"


class SuccessfulAccountCleanupService:
    async def cleanup(self) -> CleanupResult:
        return CleanupResult(scanned=4, deleted=2, skipped=2)


def test_unverified_account_cleanup_rejects_missing_cron_secret() -> None:
    response = client.post("/api/v1/auth/cleanup-unverified")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_cron_secret"


def test_unverified_account_cleanup_returns_summary() -> None:
    configured_app = create_app(Settings(
        supabase_url="https://project.example",
        supabase_secret_key="server-only-secret",
        unverified_account_cleanup_cron_secret="cleanup-secret",
    ))
    configured_app.dependency_overrides[get_unverified_account_cleanup_service] = (
        SuccessfulAccountCleanupService
    )

    response = TestClient(configured_app).post(
        "/api/v1/auth/cleanup-unverified",
        headers={"X-Cron-Secret": "cleanup-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {"scanned": 4, "deleted": 2, "skipped": 2}
