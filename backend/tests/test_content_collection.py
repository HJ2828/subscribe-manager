import asyncio
from typing import Any

from app.config import Settings
from app.content_service import ContentService


class FakeCollectionService(ContentService):
    def __init__(self) -> None:
        super().__init__(
            Settings(
                _env_file=None,
                openai_api_key="test-only",
                content_collection_cron_secret="test-only",
                content_daily_cost_limit_usd=2,
                content_development_total_limit_usd=10,
                content_estimated_cost_per_search_usd=0.05,
            )
        )
        self.item_query: dict[str, str] = {}
        self.runs: list[dict[str, Any]] = []
        self.search_calls = 0

    async def _db(self, method: str, table: str, **kwargs: Any) -> Any:
        params = kwargs.get("params") or {}
        if table == "items":
            self.item_query = params
            return [
                {"user_id": "user-1", "service_name": "Netflix"},
                {"user_id": "user-1", "service_name": "Netflix"},
            ]
        if table == "profiles":
            return [{"id": "user-1", "country_code": "KR", "timezone": "Asia/Seoul"}]
        if table == "service_catalogs" and method == "GET":
            return []
        if table == "service_catalogs" and method == "POST":
            return [
                {
                    "id": "catalog-1",
                    "display_name": "Netflix",
                    "last_news_check_at": None,
                    "next_news_check_at": None,
                }
            ]
        if table == "rpc/claim_content_collection_job":
            return (
                [
                    {
                        "run_id": "budget-run",
                        "reservation_token": None,
                        "claim_status": "budget_limited",
                    }
                ]
                if self.settings.content_daily_cost_limit_usd == 0
                else [
                    {"run_id": "run-1", "reservation_token": "token-1", "claim_status": "claimed"}
                ]
            )
        if table == "service_collection_sources":
            return []
        if table == "content_collection_runs" and method == "GET":
            return []
        if table == "content_collection_runs" and method == "PATCH":
            self.runs.append(kwargs["payload"])
            return None
        return None

    async def _search_service_news(
        self, service_name: str, country: str, timezone: str
    ) -> tuple[dict[str, Any], set[str], dict[str, int]]:
        self.search_calls += 1
        assert service_name == "Netflix"
        assert (country, timezone) == ("KR", "Asia/Seoul")
        return (
            {"outcome": "no_new_content", "news": []},
            set(),
            {
                "cost_known": 1,
                "api_requests": 1,
                "input_tokens": 100,
                "cached_input_tokens": 0,
                "output_tokens": 20,
                "web_search_calls": 1,
            },
        )

    async def _store_search_result(
        self, catalog: dict[str, Any], payload: dict[str, Any], cited_urls: set[str]
    ) -> dict[str, int]:
        return {"accepted": 0, "published": 0, "pending_review": 0}


def test_collection_is_shared_once_per_active_recurring_service() -> None:
    service = FakeCollectionService()

    result = asyncio.run(service.process_due_news())

    assert service.item_query["management_type"] == "eq.recurring_subscription"
    assert service.item_query["actual_status"] == "neq.ended"
    assert result["services"] == 1
    assert result["searched"] == 1
    assert service.runs[0]["outcome"] == "no_new_content"
    assert service.runs[0]["api_request_count"] == 1
    assert service.runs[0]["web_search_call_count"] == 1


def test_collection_stops_before_search_when_daily_budget_is_exhausted() -> None:
    service = FakeCollectionService()
    service.settings.content_daily_cost_limit_usd = 0

    result = asyncio.run(service.process_due_news())

    assert result["searched"] == 0
    assert result["budget_limited"] == 1
    assert service.search_calls == 0


def test_aliases_share_one_canonical_service() -> None:
    service = FakeCollectionService()
    assert service._canonical_service("Netflix")[0] == service._canonical_service("넷플릭스")[0]
    assert service._canonical_service("youtube")[0] == service._canonical_service("유튜브")[0]


def test_reservation_uses_token_and_tool_upper_bounds() -> None:
    service = FakeCollectionService()
    assert service._reservation_cost() >= service.settings.content_estimated_cost_per_search_usd
