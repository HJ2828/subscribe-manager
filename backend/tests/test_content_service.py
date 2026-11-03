import asyncio
from uuid import UUID

import pytest

from app.config import Settings
from app.content_service import ContentService
from app.errors import ApiError
from app.security import CurrentUser

USER = CurrentUser(UUID("11111111-1111-1111-1111-111111111111"))


def test_operator_allowlist_is_server_side_and_exact() -> None:
    service = ContentService(
        Settings(
            _env_file=None,
            phase8_operator_user_ids="11111111-1111-1111-1111-111111111111",
        )
    )

    assert asyncio.run(service.operator_status(USER)) == {"is_operator": True}


def test_non_operator_cannot_open_review_data() -> None:
    service = ContentService(Settings(_env_file=None, phase8_operator_user_ids=""))

    with pytest.raises(ApiError) as caught:
        asyncio.run(service.review_data(USER))

    assert caught.value.status_code == 403
    assert caught.value.code == "operator_required"


def test_publication_requires_matching_https_source_domain() -> None:
    with pytest.raises(ApiError) as caught:
        ContentService._validate_source(
            {
                "source_url": "https://community.example/post",
                "source_domain": "official.example",
                "checked_at": "2026-11-03T00:00:00Z",
                "announced_on": "2026-11-03",
            },
            "news",
        )

    assert caught.value.code == "official_source_required"


def test_news_requires_announced_or_effective_date() -> None:
    with pytest.raises(ApiError) as caught:
        ContentService._validate_source(
            {
                "source_url": "https://official.example/news",
                "source_domain": "official.example",
                "checked_at": "2026-11-03T00:00:00Z",
            },
            "news",
        )

    assert caught.value.code == "news_date_required"
