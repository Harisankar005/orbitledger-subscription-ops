import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.config import settings
from app.errors import UnauthorizedError, ValidationError

ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

PASSWORD_MIN_LENGTH = 9
PASSWORD_MAX_LENGTH = 128


def validate_password_strength(password: str) -> None:
    """Validate password according to security policy.

    Must be > 8 characters (min 9, max 128), contain at least one uppercase letter,
    one lowercase letter, and one special character.
    """
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ValidationError(
            f"Password must be more than 8 characters (minimum {PASSWORD_MIN_LENGTH})",
            fields={"password": f"Password must be at least {PASSWORD_MIN_LENGTH} characters long"},
        )
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ValidationError(
            f"Password cannot exceed {PASSWORD_MAX_LENGTH} characters",
            fields={"password": "Password is too long"},
        )
    if not re.search(r"[A-Z]", password):
        raise ValidationError(
            "Password must contain at least one uppercase letter",
            fields={"password": "Missing uppercase letter"},
        )
    if not re.search(r"[a-z]", password):
        raise ValidationError(
            "Password must contain at least one lowercase letter",
            fields={"password": "Missing lowercase letter"},
        )
    if not re.search(r"[^A-Za-z0-9]", password):
        raise ValidationError(
            "Password must contain at least one special character",
            fields={"password": "Missing special character (e.g. !@#$%^&*)"},
        )


def hash_password(password: str) -> str:
    """Hash password using Argon2id."""
    return ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Verify password against Argon2id hash."""
    try:
        return ph.verify(password_hash, password)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Create short-lived JWT access token (15 mins by default)."""
    to_encode = data.copy()
    now_utc = datetime.now(timezone.utc)
    if expires_delta:
        expire = now_utc + expires_delta
    else:
        expire = now_utc + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"iat": now_utc, "exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")
    return encoded_jwt


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate JWT access token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise UnauthorizedError("Access token has expired") from None
    except jwt.PyJWTError:
        raise UnauthorizedError("Invalid access token") from None


def hash_token(token: str) -> str:
    """Compute SHA-256 hash of a raw token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_random_token() -> Tuple[str, str]:
    """Generate a random 32-byte urlsafe token and its SHA-256 hash."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = hash_token(raw_token)
    return raw_token, token_hash
