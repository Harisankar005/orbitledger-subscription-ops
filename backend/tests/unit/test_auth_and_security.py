import re
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import Response
from fastapi.testclient import TestClient

from app.clock import ensure_utc
from app.config import Settings
from app.db import SessionLocal
from app.errors import ForbiddenError, UnauthorizedError, ValidationError
from app.main import app
from app.models.identity import PasswordResetToken, RefreshToken, User
from app.models.platform import OutboxMessage
from app.routers.auth import clear_refresh_cookie, set_refresh_cookie
from app.schemas.auth import RegisterRequest
from app.security import validate_password_strength
from app.services.auth import (
    login_user,
    register_customer,
    request_password_reset,
    reset_password,
    rotate_refresh_token,
)

client = TestClient(app)


def test_production_configuration_validation():
    """Verify that insecure production secrets, missing secrets, cookie settings, and unvalidated demo mode fail startup."""
    # 1. Missing secret key in production fails
    with pytest.raises(ValueError, match="SECRET_KEY environment variable is required"):
        Settings(ENVIRONMENT="production", SECRET_KEY="")

    # 2. Short secret key in production fails
    with pytest.raises(ValueError, match="SECRET_KEY must be at least 32 characters"):
        Settings(ENVIRONMENT="production", SECRET_KEY="short-key")

    # 3. Known default / placeholder secret key in production fails
    with pytest.raises(ValueError, match="cannot use default, placeholder, or known insecure strings"):
        Settings(ENVIRONMENT="production", SECRET_KEY="docker-compose-insecure-secret-key-32chars")

    with pytest.raises(ValueError, match="cannot use default, placeholder, or known insecure strings"):
        Settings(ENVIRONMENT="production", SECRET_KEY="brightloop-super-secret-key-at-least-32-chars-2026")

    # 4. Disabling secure cookies in production fails
    with pytest.raises(ValueError, match="SECURE_COOKIES cannot be False in production"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="cryptographically-strong-random-key-64-characters-prod-ready-xyz",
            SECURE_COOKIES=False,
        )

    # 5. Non-strict cookie SameSite in production fails
    with pytest.raises(ValueError, match="COOKIE_SAMESITE must be 'strict' in production"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="cryptographically-strong-random-key-64-characters-prod-ready-xyz",
            COOKIE_SAMESITE="lax",
        )

    # 6. Enabling DEMO_MODE in production without explicit override fails
    with pytest.raises(ValueError, match="DEMO_MODE cannot be enabled in production without explicit ALLOW_PRODUCTION_DEMO_OVERRIDE=True"):
        Settings(
            ENVIRONMENT="production",
            SECRET_KEY="cryptographically-strong-random-key-64-characters-prod-ready-xyz",
            DEMO_MODE=True,
        )

    # 7. Valid production settings succeed, with DEMO_MODE defaulting to False and cookies Secure
    valid_prod = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="cryptographically-strong-random-key-64-characters-prod-ready-xyz",
    )
    assert valid_prod.is_cookie_secure is True
    assert valid_prod.DEMO_MODE is False
    assert valid_prod.COOKIE_SAMESITE == "strict"

    # 8. Valid production settings with explicit override succeeds
    valid_prod_override = Settings(
        ENVIRONMENT="production",
        SECRET_KEY="cryptographically-strong-random-key-64-characters-prod-ready-xyz",
        DEMO_MODE=True,
        ALLOW_PRODUCTION_DEMO_OVERRIDE=True,
    )
    assert valid_prod_override.DEMO_MODE is True

    # 9. Local development convenience settings remain isolated and functional
    dev_settings = Settings(ENVIRONMENT="development")
    assert dev_settings.SECRET_KEY is not None
    assert len(dev_settings.SECRET_KEY) >= 32
    assert dev_settings.DEMO_MODE is True
    assert dev_settings.is_cookie_secure is False


def test_refresh_cookie_attributes():
    """Verify refresh cookie is strictly configured with HttpOnly, SameSite=Strict, and path=/api/auth."""
    resp = Response()
    set_refresh_cookie(resp, "test-raw-refresh-token")

    # Parse Set-Cookie header
    cookie_header = resp.headers.get("set-cookie")
    assert cookie_header is not None
    assert "brightloop_refresh=test-raw-refresh-token" in cookie_header
    assert "HttpOnly" in cookie_header or "httponly" in cookie_header
    assert "Path=/api/auth" in cookie_header or "path=/api/auth" in cookie_header
    assert "SameSite=strict" in cookie_header or "samesite=strict" in cookie_header

    # Clear cookie
    resp_clear = Response()
    clear_refresh_cookie(resp_clear)
    clear_header = resp_clear.headers.get("set-cookie")
    assert clear_header is not None
    assert "Path=/api/auth" in clear_header or "path=/api/auth" in clear_header


def test_password_policy_enforcement():
    """Verify password requirements: 9-128 chars, >=1 upper, >=1 lower, >=1 special character."""
    # Too short (< 9 chars)
    with pytest.raises(ValidationError):
        validate_password_strength("Short1!")

    # Missing uppercase
    with pytest.raises(ValidationError):
        validate_password_strength("lowercase123!@#")

    # Missing lowercase
    with pytest.raises(ValidationError):
        validate_password_strength("UPPERCASE123!@#")

    # Missing special character
    with pytest.raises(ValidationError):
        validate_password_strength("NoSpecialChar12345")

    # Valid password (>= 9 chars, upper, lower, special)
    validate_password_strength("ValidSecret@2026")


def test_login_lockout_after_five_failed_attempts():
    """Verify account locks for 15 minutes after 5 consecutive failed logins."""
    test_email = f"lockout-{uuid.uuid4()}@brightloop.test"
    with SessionLocal() as db:
        req = RegisterRequest(
            email=test_email,
            password="StrongPassword@123",
            full_name="Lockout Target",
        )
        register_customer(db, req)

    # 4 consecutive failures do not lock
    for _ in range(4):
        with pytest.raises(UnauthorizedError):
            with SessionLocal() as db:
                login_user(db, test_email, "WrongPassword@123")

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == test_email).first()
        assert user.failed_logins == 4
        assert user.locked_until is None

    # 5th failure triggers lockout
    with pytest.raises(UnauthorizedError):
        with SessionLocal() as db:
            login_user(db, test_email, "WrongPassword@123")

    with SessionLocal() as db:
        user = db.query(User).filter(User.email == test_email).first()
        assert user.failed_logins == 5
        assert user.locked_until is not None
        assert ensure_utc(user.locked_until) > datetime.now(timezone.utc)

    # Subsequent login attempt is blocked with ForbiddenError (account locked)
    with pytest.raises(ForbiddenError, match="Account is temporarily locked"):
        with SessionLocal() as db:
            login_user(db, test_email, "StrongPassword@123")


def test_forgot_password_enumeration_resistance():
    """Verify forgot-password returns identical responses whether email exists or not."""
    # Existing user
    resp1 = client.post("/api/auth/forgot-password", json={"email": "admin@brightloop.test"})
    assert resp1.status_code == 200

    # Non-existent user
    resp2 = client.post("/api/auth/forgot-password", json={"email": "nonexistent-ghost-user@nowhere.test"})
    assert resp2.status_code == 200

    assert resp1.json() == resp2.json()


def test_token_rotation_and_reuse_family_revocation():
    """Verify refresh token rotation and revocation of entire token family upon token reuse."""
    test_email = f"rotation-{uuid.uuid4()}@brightloop.test"
    with SessionLocal() as db:
        req = RegisterRequest(email=test_email, password="StrongPassword@123", full_name="Rotation Test")
        register_customer(db, req)
        _, raw_token_1, user = login_user(db, test_email, "StrongPassword@123")

    # Rotate 1: raw_token_1 -> raw_token_2
    with SessionLocal() as db:
        _, raw_token_2, _ = rotate_refresh_token(db, raw_token_1)

    # Verify raw_token_1 is revoked
    with SessionLocal() as db:
        t1 = db.query(RefreshToken).filter(RefreshToken.user_id == user.id).order_by(RefreshToken.id.asc()).first()
        assert t1.revoked_at is not None

    # Replay Attack: Attacker re-uses raw_token_1!
    with pytest.raises(UnauthorizedError, match="refresh token reuse detected"):
        with SessionLocal() as db:
            rotate_refresh_token(db, raw_token_1)

    # Verify the entire token family was revoked (including raw_token_2)
    with SessionLocal() as db:
        active_tokens = db.query(RefreshToken).filter(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        ).count()
        assert active_tokens == 0, "Token reuse must revoke all tokens in the entire family"


def test_password_reset_revokes_all_refresh_tokens():
    """Verify password reset invalidates all existing refresh tokens and enforces single-use tokens."""
    test_email = f"reset-{uuid.uuid4()}@brightloop.test"
    with SessionLocal() as db:
        req = RegisterRequest(email=test_email, password="OldPassword@123", full_name="Reset Test")
        register_customer(db, req)
        _, raw_refresh, user = login_user(db, test_email, "OldPassword@123")

    # Request password reset
    with SessionLocal() as db:
        request_password_reset(db, test_email)
        reset_record = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).first()
        assert reset_record is not None

    # Reset password using token
    with SessionLocal() as db:
        outbox = db.query(OutboxMessage).filter(OutboxMessage.to_email == test_email).first()
        match = re.search(r"font-size: 16px;\">(.*?)<", outbox.body_html)
        raw_reset_token = match.group(1).strip()

        reset_password(db, raw_reset_token, "NewStrongPassword@123")

    # Verify all refresh tokens are revoked
    with SessionLocal() as db:
        active_count = db.query(RefreshToken).filter(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
        ).count()
        assert active_count == 0, "Password reset must revoke all outstanding refresh tokens"

    # Verify single-use: Reusing reset token fails
    with pytest.raises(ValidationError):
        with SessionLocal() as db:
            reset_password(db, raw_reset_token, "AnotherPassword@123")
