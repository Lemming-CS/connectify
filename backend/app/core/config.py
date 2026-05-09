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
    media_root: str = "media"
    media_max_image_upload_bytes: int = 10 * 1024 * 1024
    media_max_video_upload_bytes: int = 50 * 1024 * 1024
    media_max_audio_upload_bytes: int = 20 * 1024 * 1024
    media_max_file_upload_bytes: int = 25 * 1024 * 1024

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="CONNECTIFY_",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_secret_key(self) -> "Settings":
        unsafe_secret_values = {
            "change-me-in-production",
            "replace-with-a-long-random-secret",
        }
        if (
            self.environment != "test"
            and self.secret_key in unsafe_secret_values
        ):
            msg = "CONNECTIFY_SECRET_KEY must be set outside the test environment"
            raise ValueError(msg)
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
