from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated
from uuid import UUID

import httpx
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWTError

from app.config import Settings, get_settings
from app.errors import ApiError

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class CurrentUser:
    id: UUID
    access_token: str = ""


@lru_cache
def get_jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=300)


async def require_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise ApiError(401, "authentication_required", "로그인이 필요합니다.")

    supabase_url = settings.normalized_supabase_url
    if not supabase_url:
        raise ApiError(
            503,
            "authentication_not_configured",
            "인증 연결이 아직 설정되지 않았습니다.",
        )

    issuer = f"{supabase_url}/auth/v1"
    jwks_url = f"{issuer}/.well-known/jwks.json"

    try:
        signing_key = get_jwks_client(jwks_url).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256", "ES256", "EdDSA"],
            audience="authenticated",
            issuer=issuer,
            options={"require": ["exp", "iss", "sub"]},
        )
        user = CurrentUser(id=UUID(claims["sub"]), access_token=credentials.credentials)
    except PyJWKClientConnectionError as error:
        raise ApiError(
            503,
            "authentication_unavailable",
            "인증 서버에 연결할 수 없습니다.",
        ) from error
    except (PyJWTError, KeyError, TypeError, ValueError) as error:
        raise ApiError(401, "invalid_access_token", "로그인 정보가 유효하지 않습니다.") from error

    if not settings.supabase_publishable_key:
        raise ApiError(
            503,
            "authentication_not_configured",
            "인증 연결이 아직 설정되지 않았습니다.",
        )

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{issuer}/user",
                headers={
                    "apikey": settings.supabase_publishable_key,
                    "Authorization": f"Bearer {credentials.credentials}",
                },
            )
    except httpx.HTTPError as error:
        raise ApiError(
            503,
            "authentication_unavailable",
            "인증 서버에 연결할 수 없습니다.",
        ) from error

    if response.status_code != 200:
        raise ApiError(401, "invalid_access_token", "로그인 정보가 유효하지 않습니다.")

    try:
        remote_user_id = UUID(response.json()["id"])
    except (KeyError, TypeError, ValueError) as error:
        raise ApiError(401, "invalid_access_token", "로그인 정보가 유효하지 않습니다.") from error
    if remote_user_id != user.id:
        raise ApiError(401, "invalid_access_token", "로그인 정보가 유효하지 않습니다.")
    return user
