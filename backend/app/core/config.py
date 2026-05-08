from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Connectify"
    environment: str = "development"
    database_url: str = "postgresql+psycopg2://connectify:connectify@db:5432/connectify"
    secret_key: str = Field(
        default="change-me-in-production",
        min_length=16,
    )
    access_token_expire_minutes: int = 60 * 24
    cors_origins: list[str] = ["http://localhost:3000"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="CONNECTIFY_",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_secret_key(self) -> "Settings":
        if (
            self.environment != "test"
            and self.secret_key == "change-me-in-production"
        ):
            msg = "CONNECTIFY_SECRET_KEY must be set outside the test environment"
            raise ValueError(msg)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
