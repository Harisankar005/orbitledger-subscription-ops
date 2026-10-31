from functools import lru_cache
from typing import Literal, Optional

from pydantic import model_validator
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

    # Cookie security settings
    SECURE_COOKIES: Optional[bool] = None
    COOKIE_SAMESITE: str = "strict"

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

    @property
    def is_cookie_secure(self) -> bool:
        if self.SECURE_COOKIES is not None:
            return self.SECURE_COOKIES
        return self.ENVIRONMENT == "production"

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.ENVIRONMENT == "production":
            insecure_markers = [
                "docker-compose",
                "insecure",
                "brightloop-super-secret",
                "dev-secret",
                "change-in-production",
                "placeholder",
                "12345",
                "secret-key-at-least-32-chars",
            ]
            if (
                len(self.SECRET_KEY) < 32
                or any(m in self.SECRET_KEY.lower() for m in insecure_markers)
            ):
                raise ValueError(
                    "Production security violation: SECRET_KEY must be at least 32 characters "
                    "and cannot use default, placeholder, or known insecure strings."
                )
            if self.SECURE_COOKIES is False:
                raise ValueError(
                    "Production security violation: SECURE_COOKIES cannot be False in production."
                )
            # In production, default DEMO_MODE to False unless explicitly set
            if "DEMO_MODE" not in self.model_fields_set:
                self.DEMO_MODE = False
        return self


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
