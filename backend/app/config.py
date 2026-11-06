from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_environment: str = "development"
    api_cors_origins: str = "http://localhost:5173"
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_secret_key: str | None = None
    brandfetch_api_key: str | None = None
    brandfetch_client_id: str | None = None
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    openai_daily_analysis_limit: int = 10
    openai_daily_cost_limit_usd: float = 0.20
    openai_estimated_cost_per_analysis_usd: float = 0.02
    vapid_public_key: str | None = None
    vapid_private_key: str | None = None
    vapid_subject: str = "mailto:admin@example.invalid"
    notification_cron_secret: str | None = None
    notification_max_attempts: int = 3
    unverified_account_cleanup_cron_secret: str | None = None
    unverified_account_retention_days: int = 7
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: str | None = None
    google_oauth_redirect_uri: str = "http://localhost:8000/api/v1/google-calendar/callback"
    google_token_encryption_key: str | None = None
    google_calendar_cron_secret: str | None = None
    frontend_app_url: str = "http://localhost:5173"
    phase8_operator_user_ids: str = ""
    content_collection_model: str = "gpt-5.4-mini"
    content_collection_cron_secret: str | None = None
    content_daily_cost_limit_usd: float = 0.50
    content_development_total_limit_usd: float = 10.0
    content_estimated_cost_per_search_usd: float = 0.05
    content_collection_interval_hours: int = 72
    content_daily_service_job_limit: int = 5
    content_max_input_tokens: int = 16_000
    content_max_output_tokens: int = 2_000
    content_max_web_search_calls: int = 2
    content_model_input_cost_per_million_usd: float = 0.75
    content_model_cached_input_cost_per_million_usd: float = 0.075
    content_model_output_cost_per_million_usd: float = 4.50
    content_web_search_cost_per_call_usd: float = 0.01
    content_ott_editorial_enabled: bool = True

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @property
    def normalized_supabase_url(self) -> str | None:
        if not self.supabase_url:
            return None
        return self.supabase_url.rstrip("/")

    @property
    def phase8_operator_ids(self) -> set[str]:
        return {
            value.strip().lower()
            for value in self.phase8_operator_user_ids.split(",")
            if value.strip()
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
