import asyncio
import hashlib
from datetime import date
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from cryptography.fernet import Fernet

from app.config import Settings
from app.google_calendar_service import GOOGLE_SCOPE, GoogleCalendarService
from app.security import CurrentUser


def configured_settings() -> Settings:
    return Settings(
        supabase_url="https://project.example.test",
        supabase_secret_key="service-key",
        google_oauth_client_id="client-id",
        google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/v1/google-calendar/callback",
        google_token_encryption_key=Fernet.generate_key().decode(),
    )


class CapturingService(GoogleCalendarService):
    def __init__(self) -> None:
        super().__init__(configured_settings())
        self.state_payload = None

    async def _db(self, method, table, **kwargs):
        assert method == "POST"
        assert table == "google_oauth_states"
        self.state_payload = kwargs["payload"]
        return None


def test_authorization_url_uses_narrow_offline_scope_and_hashed_state() -> None:
    service = CapturingService()
    user = CurrentUser(UUID("11111111-1111-1111-1111-111111111111"))
    url = asyncio.run(service.authorization_url(user))
    query = parse_qs(urlparse(url).query)

    assert query["scope"] == [GOOGLE_SCOPE]
    assert query["access_type"] == ["offline"]
    assert query["include_granted_scopes"] == ["true"]
    assert (
        service.state_payload["state_hash"]
        == hashlib.sha256(query["state"][0].encode()).hexdigest()
    )
    assert query["state"][0] not in str(service.state_payload)


def test_tokens_are_encrypted_before_storage() -> None:
    service = GoogleCalendarService(configured_settings())
    encrypted = service._encrypt("refresh-token")

    assert encrypted != "refresh-token"
    assert service._decrypt(encrypted) == "refresh-token"


def test_google_event_is_all_day_and_carries_internal_identity() -> None:
    body = GoogleCalendarService._event_body(
        {
            "id": "event-id",
            "source_key": "item:payment:2026-11-03",
            "event_date": date(2026, 11, 3).isoformat(),
            "title": "왓챠 결제",
        }
    )

    assert body["start"]["date"] == "2026-11-03"
    assert body["end"]["date"] == "2026-11-04"
    assert body["extendedProperties"]["private"]["subscribeManagerEventId"] == "event-id"


def test_unconfigured_status_does_not_attempt_external_storage() -> None:
    service = GoogleCalendarService(Settings())
    result = asyncio.run(service.status(CurrentUser(UUID("11111111-1111-1111-1111-111111111111"))))

    assert result["configured"] is False
    assert result["status"] == "disconnected"
