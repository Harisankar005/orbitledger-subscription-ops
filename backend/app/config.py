from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENVIRONMENT: Literal["development", "production", "test"] = "development"
    SECRET_KEY: str = "brightloop-super-secret-key-at-least-32-chars-2026"
    DATABASE_URL: str = "sqlite:///./brightloop.db"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    TIMEZONE: str = "Asia/Kolkata"
    EMBEDDED_WORKER: bool = True
    DEMO_MODE: bool = True

    # SMTP / Outbox settings
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 1025
    SMTP_FROM: str = "billing@brightloop.test"
    SMTP_TLS: bool = False

    # Security settings
    LOGIN_MAX_ATTEMPTS: int = 5
    LOCKOUT_MINUTES: int = 15
    PASSWORD_RESET_TOKEN_MINUTES: int = 30

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
