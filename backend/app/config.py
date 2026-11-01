from functools import lru_cache
from typing import Literal, Optional

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "brightloop-dev-secret-key-only-for-local-development-32chars"


class Settings(BaseSettings):
    ENVIRONMENT: Literal["development", "production", "test"] = "development"
    SECRET_KEY: Optional[str] = None
    DATABASE_URL: str = "sqlite:///./brightloop.db"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    TIMEZONE: str = "Asia/Kolkata"
    EMBEDDED_WORKER: bool = True
    DEMO_MODE: bool = True
    ALLOW_PRODUCTION_DEMO_OVERRIDE: bool = False
    MAX_CATCHUP_PERIODS: int = 12

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
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("SECURE_COOKIES", mode="before")
    @classmethod
    def parse_secure_cookies(cls, v):
        if v == "" or v is None:
            return None
        return v

    @property
    def is_cookie_secure(self) -> bool:
        if self.ENVIRONMENT == "production":
            return True
        if self.SECURE_COOKIES is not None:
            return self.SECURE_COOKIES
        return False

    @model_validator(mode="after")
    def validate_environment_settings(self) -> "Settings":
        if self.ENVIRONMENT in ("development", "test"):
            if not self.SECRET_KEY:
                self.SECRET_KEY = DEV_SECRET_KEY
            if self.SECURE_COOKIES is None:
                self.SECURE_COOKIES = False
            return self

        # Production environment validation
        if not self.SECRET_KEY or self.SECRET_KEY == DEV_SECRET_KEY:
            raise ValueError(
                "Production configuration error: SECRET_KEY environment variable is required and must be explicitly set."
            )

        insecure_markers = [
            "docker-compose",
            "insecure",
            "brightloop-super-secret",
            "dev-secret",
            "change-in-production",
            "placeholder",
            "12345",
            "secret-key-at-least-32-chars",
            "replace-with-a-secure",
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
        self.SECURE_COOKIES = True

        if self.COOKIE_SAMESITE.lower() != "strict":
            raise ValueError(
                "Production security violation: COOKIE_SAMESITE must be 'strict' in production."
            )

        if "DEMO_MODE" not in self.model_fields_set:
            self.DEMO_MODE = False
        elif self.DEMO_MODE is True and not self.ALLOW_PRODUCTION_DEMO_OVERRIDE:
            raise ValueError(
                "Production security violation: DEMO_MODE cannot be enabled in production without explicit ALLOW_PRODUCTION_DEMO_OVERRIDE=True."
            )

        return self


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
