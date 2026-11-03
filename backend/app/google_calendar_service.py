import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any
from urllib.parse import quote, urlencode
from uuid import UUID

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings, get_settings
from app.errors import ApiError
from app.security import CurrentUser

GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created"
EVENT_TYPES = {"payment", "renewal", "cancellation", "review", "expiry", "warranty"}
GOOGLE_API = "https://www.googleapis.com/calendar/v3"


@dataclass(slots=True)
class SyncResult:
    created: int = 0
    updated: int = 0
    deleted: int = 0
    failed: int = 0


class GoogleCalendarService:
    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def configured(self) -> bool:
        return bool(
            self.settings.normalized_supabase_url
            and self.settings.supabase_secret_key
            and self.settings.google_oauth_client_id
            and self.settings.google_oauth_client_secret
            and self.settings.google_oauth_redirect_uri
            and self.settings.google_token_encryption_key
        )

    def _require_configured(self) -> None:
        if not self.configured:
            raise ApiError(
                503,
                "google_calendar_not_configured",
                "Google Calendar 연결 설정이 완료되지 않았습니다.",
            )

    def _fernet(self) -> Fernet:
        self._require_configured()
        try:
            return Fernet(str(self.settings.google_token_encryption_key).encode())
        except (TypeError, ValueError) as error:
            raise ApiError(
                503,
                "google_calendar_not_configured",
                "Google Calendar 토큰 암호화 설정을 확인해 주세요.",
            ) from error

    def _encrypt(self, value: str | None) -> str | None:
        return self._fernet().encrypt(value.encode()).decode() if value else None

    def _decrypt(self, value: str | None) -> str | None:
        if not value:
            return None
        try:
            return self._fernet().decrypt(value.encode()).decode()
        except InvalidToken as error:
            raise ApiError(
                409, "google_reconnect_required", "Google Calendar를 다시 연결해 주세요."
            ) from error

    def _db_headers(self, prefer: str | None = None) -> dict[str, str]:
        key = self.settings.supabase_secret_key
        if not key:
            self._require_configured()
            raise AssertionError("unreachable")
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def _db(
        self,
        method: str,
        table: str,
        *,
        params: dict[str, str] | None = None,
        payload: Any = None,
        prefer: str | None = None,
    ) -> Any:
        self._require_configured()
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.request(
                    method,
                    f"{self.settings.normalized_supabase_url}/rest/v1/{table}",
                    headers=self._db_headers(prefer),
                    params=params,
                    json=payload,
                )
        except httpx.HTTPError as error:
            raise ApiError(
                503,
                "google_calendar_storage_unavailable",
                "Google Calendar 연결 저장소에 접근하지 못했습니다.",
            ) from error
        if response.status_code >= 400:
            raise ApiError(
                502,
                "google_calendar_storage_failed",
                "Google Calendar 연결 정보를 처리하지 못했습니다.",
            )
        if not response.content:
            return None
        return response.json()

    async def _connection(self, user_id: UUID) -> dict[str, Any] | None:
        rows = await self._db(
            "GET",
            "google_calendar_connections",
            params={"user_id": f"eq.{user_id}", "select": "*", "limit": "1"},
        )
        return rows[0] if rows else None

    async def status(self, user: CurrentUser) -> dict[str, Any]:
        if not self.configured:
            return {
                "configured": False,
                "status": "disconnected",
                "calendar_name": "subscribe-manager",
                "selected_event_types": sorted(EVENT_TYPES),
                "last_sync_at": None,
                "last_error": None,
            }
        connection = await self._connection(user.id)
        return {
            "configured": True,
            "status": connection.get("status", "disconnected") if connection else "disconnected",
            "calendar_name": connection.get("calendar_name", "subscribe-manager")
            if connection
            else "subscribe-manager",
            "selected_event_types": connection.get("selected_event_types", sorted(EVENT_TYPES))
            if connection
            else sorted(EVENT_TYPES),
            "last_sync_at": connection.get("last_sync_at") if connection else None,
            "last_error": connection.get("last_error") if connection else None,
        }

    async def authorization_url(self, user: CurrentUser) -> str:
        self._require_configured()
        state = secrets.token_urlsafe(32)
        state_hash = hashlib.sha256(state.encode()).hexdigest()
        await self._db(
            "POST",
            "google_oauth_states",
            payload={
                "state_hash": state_hash,
                "user_id": str(user.id),
                "expires_at": (datetime.now(UTC) + timedelta(minutes=10)).isoformat(),
            },
        )
        query = urlencode(
            {
                "client_id": self.settings.google_oauth_client_id,
                "redirect_uri": self.settings.google_oauth_redirect_uri,
                "response_type": "code",
                "scope": GOOGLE_SCOPE,
                "access_type": "offline",
                "include_granted_scopes": "true",
                "prompt": "consent",
                "state": state,
            }
        )
        return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"

    async def _consume_state(self, state: str) -> UUID:
        state_hash = hashlib.sha256(state.encode()).hexdigest()
        rows = await self._db(
            "GET",
            "google_oauth_states",
            params={
                "state_hash": f"eq.{state_hash}",
                "used_at": "is.null",
                "select": "*",
                "limit": "1",
            },
        )
        if not rows:
            raise ApiError(
                400, "invalid_oauth_state", "Google 연결 요청이 만료되었거나 유효하지 않습니다."
            )
        row = rows[0]
        if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= datetime.now(UTC):
            raise ApiError(
                400, "expired_oauth_state", "Google 연결 요청이 만료되었습니다. 다시 시도해 주세요."
            )
        consumed = await self._db(
            "PATCH",
            "google_oauth_states",
            params={"state_hash": f"eq.{state_hash}", "used_at": "is.null"},
            payload={"used_at": datetime.now(UTC).isoformat()},
            prefer="return=representation",
        )
        if not consumed:
            raise ApiError(
                400,
                "invalid_oauth_state",
                "이미 처리된 Google 연결 요청입니다. 다시 시도해 주세요.",
            )
        return UUID(row["user_id"])

    async def _token_exchange(self, payload: dict[str, str]) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                response = await client.post("https://oauth2.googleapis.com/token", data=payload)
        except httpx.HTTPError as error:
            raise ApiError(
                503, "google_oauth_unavailable", "Google 인증 서버에 연결하지 못했습니다."
            ) from error
        if response.status_code != 200:
            raise ApiError(
                400, "google_oauth_failed", "Google Calendar 권한을 확인하지 못했습니다."
            )
        return response.json()

    async def _google(
        self,
        method: str,
        path: str,
        access_token: str,
        *,
        payload: Any = None,
    ) -> httpx.Response:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                return await client.request(
                    method,
                    f"{GOOGLE_API}{path}",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except httpx.HTTPError:
            return httpx.Response(503)

    async def _ensure_calendar(self, access_token: str, existing_id: str | None) -> str:
        if existing_id:
            response = await self._google(
                "GET", f"/calendars/{quote(existing_id, safe='')}", access_token
            )
            if response.status_code == 200:
                return existing_id
        response = await self._google(
            "POST",
            "/calendars",
            access_token,
            payload={
                "summary": "subscribe-manager",
                "description": "subscribe-manager에서 단방향으로 내보낸 일정입니다.",
            },
        )
        if response.status_code not in (200, 201):
            raise ApiError(
                502, "google_calendar_create_failed", "Google 전용 캘린더를 만들지 못했습니다."
            )
        return response.json()["id"]

    async def complete_oauth(self, code: str, state: str) -> UUID:
        self._require_configured()
        user_id = await self._consume_state(state)
        token = await self._token_exchange(
            {
                "code": code,
                "client_id": str(self.settings.google_oauth_client_id),
                "client_secret": str(self.settings.google_oauth_client_secret),
                "redirect_uri": self.settings.google_oauth_redirect_uri,
                "grant_type": "authorization_code",
            }
        )
        existing = await self._connection(user_id)
        refresh_token = token.get("refresh_token")
        if not refresh_token and existing:
            refresh_token = self._decrypt(existing.get("refresh_token_ciphertext"))
        if not refresh_token:
            raise ApiError(
                400,
                "google_refresh_token_missing",
                "Google Calendar를 다시 연결하고 권한에 동의해 주세요.",
            )
        calendar_id = await self._ensure_calendar(
            token["access_token"], existing.get("google_calendar_id") if existing else None
        )
        expires_at = datetime.now(UTC) + timedelta(seconds=int(token.get("expires_in", 3600)))
        payload = {
            "user_id": str(user_id),
            "google_calendar_id": calendar_id,
            "calendar_name": "subscribe-manager",
            "access_token_ciphertext": self._encrypt(token["access_token"]),
            "refresh_token_ciphertext": self._encrypt(refresh_token),
            "token_expires_at": expires_at.isoformat(),
            "granted_scope": token.get("scope", GOOGLE_SCOPE),
            "status": "connected",
            "last_error": None,
        }
        await self._db(
            "POST",
            "google_calendar_connections",
            params={"on_conflict": "user_id"},
            payload=payload,
            prefer="resolution=merge-duplicates",
        )
        await self.sync_user(user_id)
        return user_id

    async def _access_token(self, connection: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        expires = connection.get("token_expires_at")
        if expires and datetime.fromisoformat(expires.replace("Z", "+00:00")) > datetime.now(
            UTC
        ) + timedelta(minutes=2):
            token = self._decrypt(connection.get("access_token_ciphertext"))
            if token:
                return token, connection
        refresh = self._decrypt(connection.get("refresh_token_ciphertext"))
        if not refresh:
            await self._mark_reauth(UUID(connection["user_id"]), "refresh_token_missing")
            raise ApiError(
                409, "google_reconnect_required", "Google Calendar를 다시 연결해 주세요."
            )
        try:
            token = await self._token_exchange(
                {
                    "client_id": str(self.settings.google_oauth_client_id),
                    "client_secret": str(self.settings.google_oauth_client_secret),
                    "refresh_token": refresh,
                    "grant_type": "refresh_token",
                }
            )
        except ApiError as error:
            if error.status_code == 503:
                await self._db(
                    "PATCH",
                    "google_calendar_connections",
                    params={"user_id": f"eq.{connection['user_id']}"},
                    payload={
                        "status": "sync_delayed",
                        "last_error": "token_refresh_unavailable",
                    },
                )
                raise
            await self._mark_reauth(UUID(connection["user_id"]), "token_refresh_failed")
            raise ApiError(
                409, "google_reconnect_required", "Google Calendar를 다시 연결해 주세요."
            ) from error
        expires_at = datetime.now(UTC) + timedelta(seconds=int(token.get("expires_in", 3600)))
        await self._db(
            "PATCH",
            "google_calendar_connections",
            params={"user_id": f"eq.{connection['user_id']}"},
            payload={
                "access_token_ciphertext": self._encrypt(token["access_token"]),
                "token_expires_at": expires_at.isoformat(),
                "status": "connected",
                "last_error": None,
            },
        )
        connection = {
            **connection,
            "token_expires_at": expires_at.isoformat(),
            "access_token_ciphertext": self._encrypt(token["access_token"]),
        }
        return token["access_token"], connection

    async def _mark_reauth(self, user_id: UUID, reason: str) -> None:
        await self._db(
            "PATCH",
            "google_calendar_connections",
            params={"user_id": f"eq.{user_id}"},
            payload={"status": "reauth_required", "last_error": reason},
        )

    async def _check_google_auth(self, user_id: UUID, response: httpx.Response) -> None:
        if response.status_code not in (401, 403):
            return
        await self._mark_reauth(user_id, f"google_{response.status_code}")
        raise ApiError(409, "google_reconnect_required", "Google Calendar를 다시 연결해 주세요.")

    @staticmethod
    def _event_body(event: dict[str, Any]) -> dict[str, Any]:
        start = date.fromisoformat(event["event_date"])
        return {
            "summary": event["title"],
            "description": (
                "subscribe-manager의 내부 일정을 원본으로 내보냈습니다. "
                "Google에서 수정한 내용은 앱으로 가져오지 않습니다."
            ),
            "start": {"date": start.isoformat()},
            "end": {"date": (start + timedelta(days=1)).isoformat()},
            "transparency": "transparent",
            "extendedProperties": {
                "private": {
                    "subscribeManagerEventId": event["id"],
                    "subscribeManagerSourceKey": event["source_key"],
                }
            },
        }

    @staticmethod
    def _event_path(calendar_id: str, google_event_id: str) -> str:
        return f"/calendars/{quote(calendar_id, safe='')}/events/{quote(google_event_id, safe='')}"

    async def update_event_types(self, user: CurrentUser, event_types: list[str]) -> SyncResult:
        selected = sorted(set(event_types))
        if not selected or not set(selected) <= EVENT_TYPES:
            raise ApiError(
                422, "invalid_google_event_types", "내보낼 일정 종류를 하나 이상 선택해 주세요."
            )
        connection = await self._connection(user.id)
        if not connection:
            raise ApiError(
                409, "google_calendar_not_connected", "Google Calendar를 먼저 연결해 주세요."
            )
        await self._db(
            "PATCH",
            "google_calendar_connections",
            params={"user_id": f"eq.{user.id}"},
            payload={"selected_event_types": selected},
        )
        return await self.sync_user(user.id)

    async def sync_user(self, user_id: UUID) -> SyncResult:
        connection = await self._connection(user_id)
        if not connection or connection.get("status") == "disconnected":
            raise ApiError(
                409, "google_calendar_not_connected", "Google Calendar를 먼저 연결해 주세요."
            )
        access_token, connection = await self._access_token(connection)
        calendar_id = connection.get("google_calendar_id")
        if not calendar_id:
            raise ApiError(
                409, "google_reconnect_required", "Google Calendar를 다시 연결해 주세요."
            )
        selected = set(connection.get("selected_event_types") or EVENT_TYPES)
        events = await self._db(
            "GET",
            "calendar_events",
            params={
                "user_id": f"eq.{user_id}",
                "select": "id,source_key,event_type,title,event_date,schedule_status",
            },
        )
        active_events = {
            row["source_key"]: row
            for row in events
            if row["event_type"] in selected
            and row.get("schedule_status", "scheduled") == "scheduled"
        }
        mappings = await self._db(
            "GET",
            "google_calendar_event_mappings",
            params={"user_id": f"eq.{user_id}", "select": "*"},
        )
        mapped = {row["source_key"]: row for row in mappings}
        result = SyncResult()

        for source_key, mapping in mapped.items():
            if source_key in active_events:
                continue
            response = await self._google(
                "DELETE",
                self._event_path(calendar_id, mapping["google_event_id"]),
                access_token,
            )
            await self._check_google_auth(user_id, response)
            if response.status_code in (200, 204, 404, 410):
                await self._db(
                    "DELETE", "google_calendar_event_mappings", params={"id": f"eq.{mapping['id']}"}
                )
                result.deleted += 1
            else:
                await self._db(
                    "PATCH",
                    "google_calendar_event_mappings",
                    params={"id": f"eq.{mapping['id']}"},
                    payload={
                        "sync_status": "delete_failed",
                        "last_error": f"google_{response.status_code}",
                    },
                )
                result.failed += 1

        for source_key, event in active_events.items():
            mapping = mapped.get(source_key)
            body = self._event_body(event)
            response = None
            if mapping:
                response = await self._google(
                    "PATCH",
                    self._event_path(calendar_id, mapping["google_event_id"]),
                    access_token,
                    payload=body,
                )
                await self._check_google_auth(user_id, response)
            if not mapping or (response and response.status_code in (404, 410)):
                response = await self._google(
                    "POST",
                    f"/calendars/{quote(calendar_id, safe='')}/events",
                    access_token,
                    payload=body,
                )
                await self._check_google_auth(user_id, response)
                action = "created"
            else:
                action = "updated"
            if response.status_code in (200, 201):
                google_event_id = response.json()["id"]
                await self._db(
                    "POST",
                    "google_calendar_event_mappings",
                    params={"on_conflict": "user_id,source_key"},
                    payload={
                        "user_id": str(user_id),
                        "calendar_event_id": event["id"],
                        "source_key": source_key,
                        "google_calendar_id": calendar_id,
                        "google_event_id": google_event_id,
                        "sync_status": "synced",
                        "synced_at": datetime.now(UTC).isoformat(),
                        "last_error": None,
                    },
                    prefer="resolution=merge-duplicates",
                )
                if action == "created":
                    result.created += 1
                else:
                    result.updated += 1
            else:
                result.failed += 1

        await self._db(
            "PATCH",
            "google_calendar_connections",
            params={"user_id": f"eq.{user_id}"},
            payload={
                "status": "sync_delayed" if result.failed else "connected",
                "last_sync_at": datetime.now(UTC).isoformat(),
                "last_error": f"{result.failed}_failed" if result.failed else None,
            },
        )
        return result

    async def disconnect(self, user: CurrentUser, delete_events: bool) -> SyncResult:
        connection = await self._connection(user.id)
        if not connection:
            return SyncResult()
        result = SyncResult()
        if delete_events and connection.get("google_calendar_id"):
            try:
                access_token, _ = await self._access_token(connection)
                mappings = await self._db(
                    "GET",
                    "google_calendar_event_mappings",
                    params={"user_id": f"eq.{user.id}", "select": "*"},
                )
                for mapping in mappings:
                    response = await self._google(
                        "DELETE",
                        self._event_path(
                            connection["google_calendar_id"], mapping["google_event_id"]
                        ),
                        access_token,
                    )
                    await self._check_google_auth(user.id, response)
                    if response.status_code in (200, 204, 404, 410):
                        result.deleted += 1
                    else:
                        result.failed += 1
            except ApiError:
                result.failed += 1
        await self._db(
            "DELETE", "google_calendar_event_mappings", params={"user_id": f"eq.{user.id}"}
        )
        await self._db(
            "PATCH",
            "google_calendar_connections",
            params={"user_id": f"eq.{user.id}"},
            payload={
                "access_token_ciphertext": None,
                "refresh_token_ciphertext": None,
                "token_expires_at": None,
                "status": "disconnected",
                "last_error": f"cleanup_failed:{result.failed}" if result.failed else None,
            },
        )
        return result

    async def process_all(self) -> dict[str, int]:
        rows = await self._db(
            "GET",
            "google_calendar_connections",
            params={"status": "in.(connected,sync_delayed)", "select": "user_id"},
        )
        processed = failed = 0
        for row in rows:
            try:
                await self.sync_user(UUID(row["user_id"]))
                processed += 1
            except ApiError:
                failed += 1
        return {"processed": processed, "failed": failed}


@lru_cache
def get_google_calendar_service() -> GoogleCalendarService:
    return GoogleCalendarService(get_settings())
