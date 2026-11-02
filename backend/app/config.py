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
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    openai_daily_analysis_limit: int = 10
    openai_daily_cost_limit_usd: float = 0.20
    openai_estimated_cost_per_analysis_usd: float = 0.02

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @property
    def normalized_supabase_url(self) -> str | None:
        if not self.supabase_url:
            return None
        return self.supabase_url.rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
