import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from app.config import settings
from app.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthorizedError,
    ValidationError,
)
from app.models.identity import Customer, PasswordResetToken, RefreshToken, User
from app.models.platform import OutboxMessage
from app.schemas.auth import RegisterRequest
from app.security import (
    create_access_token,
    generate_random_token,
    hash_password,
    hash_token,
    validate_password_strength,
    verify_password,
)
from app.services.audit import log_audit


def register_customer(db: Session, req: RegisterRequest, request_id: Optional[str] = None) -> Tuple[User, Customer]:
    """Register a new customer account, enforcing password policy, unique email, and creating Customer entity."""
    clean_email = req.email.strip().lower()
    validate_password_strength(req.password)

    existing_user = db.query(User).filter(User.email == clean_email).first()
    if existing_user:
        raise ConflictError("An account with this email already exists", fields={"email": "Email is already registered"})

    user = User(
        email=clean_email,
        password_hash=hash_password(req.password),
        role="customer",
        full_name=req.full_name.strip(),
        is_active=True,
    )
    db.add(user)
    db.flush()

    customer = Customer(
        user_id=user.id,
        name=req.full_name.strip(),
        email=clean_email,
        phone=req.phone,
        company=req.company,
        billing_address=req.billing_address,
        tax_id=req.tax_id,
    )
    db.add(customer)
    db.flush()

    log_audit(
        db=db,
        actor_id=user.id,
        action="user.registered",
        entity_type="user",
        entity_id=user.id,
        after={"email": user.email, "role": user.role},
        request_id=request_id,
    )

    db.commit()
    db.refresh(user)
    db.refresh(customer)
    return user, customer


def login_user(
    db: Session,
    email: str,
    password: str,
    request_id: Optional[str] = None,
) -> Tuple[str, str, User]:
    """Authenticate user with rate-lockout defense, returning access token, refresh token, and user."""
    clean_email = email.strip().lower()
    user = db.query(User).filter(User.email == clean_email).first()

    now_utc = datetime.now(timezone.utc)

    # Prevent timing attack / user enumeration while checking lock
    if user:
        if user.locked_until and user.locked_until > now_utc:
            remaining = int((user.locked_until - now_utc).total_seconds() / 60) + 1
            raise ForbiddenError(f"Account is temporarily locked. Please try again in {remaining} minutes.")

        if not user.is_active:
            raise ForbiddenError("Account is inactive")

        if not verify_password(user.password_hash, password):
            user.failed_logins += 1
            if user.failed_logins >= settings.LOGIN_MAX_ATTEMPTS:
                user.locked_until = now_utc + timedelta(minutes=settings.LOCKOUT_MINUTES)
                log_audit(
                    db=db,
                    actor_id=user.id,
                    action="user.locked",
                    entity_type="user",
                    entity_id=user.id,
                    after={"failed_logins": user.failed_logins, "locked_until": user.locked_until.isoformat()},
                    request_id=request_id,
                )
            db.commit()
            raise UnauthorizedError("Invalid email or password")
    else:
        # Constant time dummy check to mitigate timing enumeration
        hash_password("dummy-password-for-timing-consistency-1234")
        raise UnauthorizedError("Invalid email or password")

    # Reset failure counter upon successful login
    user.failed_logins = 0
    user.locked_until = None

    # Issue access token
    access_token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.full_name,
    })

    # Issue rotating refresh token with family tracking
    raw_refresh, token_hash = generate_random_token()
    family_id = secrets.token_hex(16)
    expires_at = now_utc + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    refresh_entity = RefreshToken(
        user_id=user.id,
        family_id=family_id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(refresh_entity)

    log_audit(
        db=db,
        actor_id=user.id,
        action="user.login",
        entity_type="user",
        entity_id=user.id,
        after={"email": user.email},
        request_id=request_id,
    )

    db.commit()
    db.refresh(user)
    return access_token, raw_refresh, user


def rotate_refresh_token(
    db: Session,
    raw_token: str,
    request_id: Optional[str] = None,
) -> Tuple[str, str, User]:
    """Rotate refresh token. Detects reuse attacks and invalidates the entire token family."""
    token_hash = hash_token(raw_token)
    token_record = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()

    now_utc = datetime.now(timezone.utc)

    if not token_record:
        raise UnauthorizedError("Invalid refresh token")

    # Reuse detection: if this token was already revoked, someone is replaying it!
    if token_record.revoked_at is not None:
        db.query(RefreshToken).filter(
            RefreshToken.family_id == token_record.family_id,
            RefreshToken.revoked_at.is_(None),
        ).update({"revoked_at": now_utc}, synchronize_session=False)
        db.commit()
        log_audit(
            db=db,
            actor_id=token_record.user_id,
            action="security.token_reuse_detected",
            entity_type="refresh_token",
            entity_id=token_record.id,
            after={"family_id": token_record.family_id},
            request_id=request_id,
        )
        raise UnauthorizedError("Security violation: refresh token reuse detected. All active sessions invalidated.")

    if token_record.expires_at < now_utc:
        raise UnauthorizedError("Refresh token has expired")

    user = db.query(User).filter(User.id == token_record.user_id).first()
    if not user or not user.is_active:
        raise ForbiddenError("User is not active")

    # Revoke old token and generate replacement
    new_raw, new_hash = generate_random_token()
    token_record.revoked_at = now_utc
    token_record.replaced_by = new_hash

    new_token_record = RefreshToken(
        user_id=user.id,
        family_id=token_record.family_id,
        token_hash=new_hash,
        expires_at=now_utc + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_token_record)

    new_access_token = create_access_token({
        "sub": str(user.id),
        "email": user.email,
        "role": user.role,
        "name": user.full_name,
    })

    db.commit()
    return new_access_token, new_raw, user


def logout_user(db: Session, raw_token: Optional[str]) -> None:
    """Revoke refresh token on logout."""
    if not raw_token:
        return
    token_hash = hash_token(raw_token)
    token_record = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()
    if token_record and not token_record.revoked_at:
        token_record.revoked_at = datetime.now(timezone.utc)
        db.commit()


def request_password_reset(db: Session, email: str, request_id: Optional[str] = None) -> None:
    """Initiate password reset flow via outbox queue with generic response to prevent email enumeration."""
    clean_email = email.strip().lower()
    user = db.query(User).filter(User.email == clean_email).first()

    if user and user.is_active:
        raw_token, token_hash = generate_random_token()
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_MINUTES)

        reset_token = PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        db.add(reset_token)

        # Enqueue email via outbox pattern
        reset_link = f"/reset-password?token={raw_token}"
        email_body = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px;">
            <h2>Reset Your Brightloop Password</h2>
            <p>Hello {user.full_name},</p>
            <p>We received a request to reset your password. Use the token or link below within {settings.PASSWORD_RESET_TOKEN_MINUTES} minutes:</p>
            <p style="background: #f1f5f9; padding: 12px; font-family: monospace; font-size: 16px;">{raw_token}</p>
            <p><a href="{reset_link}" style="display: inline-block; padding: 10px 20px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 6px;">Reset Password</a></p>
            <p>If you did not request this, you can safely ignore this email.</p>
        </div>
        """
        outbox = OutboxMessage(
            to_email=clean_email,
            subject="Reset your Brightloop password",
            body_html=email_body,
            kind="password_reset",
            status="pending",
        )
        db.add(outbox)

        log_audit(
            db=db,
            actor_id=user.id,
            action="user.password_reset_requested",
            entity_type="user",
            entity_id=user.id,
            request_id=request_id,
        )
        db.commit()


def reset_password(db: Session, token: str, new_password: str, request_id: Optional[str] = None) -> None:
    """Reset user password using token, revoking all existing sessions."""
    validate_password_strength(new_password)
    token_hash = hash_token(token)

    now_utc = datetime.now(timezone.utc)
    reset_record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == token_hash,
        PasswordResetToken.used_at.is_(None),
        PasswordResetToken.expires_at > now_utc,
    ).first()

    if not reset_record:
        raise ValidationError("Invalid or expired password reset token", fields={"token": "Reset token is invalid or has expired"})

    user = db.query(User).filter(User.id == reset_record.user_id).first()
    if not user:
        raise NotFoundError("User not found")

    reset_record.used_at = now_utc
    user.password_hash = hash_password(new_password)
    user.failed_logins = 0
    user.locked_until = None

    # Security requirement: Resetting revokes all refresh tokens
    db.query(RefreshToken).filter(
        RefreshToken.user_id == user.id,
        RefreshToken.revoked_at.is_(None),
    ).update({"revoked_at": now_utc}, synchronize_session=False)

    log_audit(
        db=db,
        actor_id=user.id,
        action="user.password_reset_completed",
        entity_type="user",
        entity_id=user.id,
        request_id=request_id,
    )
    db.commit()


def create_staff_user(
    db: Session,
    admin_user: User,
    email: str,
    password: str,
    full_name: str,
    request_id: Optional[str] = None,
) -> User:
    """Create a staff user (admin only)."""
    clean_email = email.strip().lower()
    validate_password_strength(password)

    if db.query(User).filter(User.email == clean_email).first():
        raise ConflictError("A user with this email already exists", fields={"email": "Email already registered"})

    staff = User(
        email=clean_email,
        password_hash=hash_password(password),
        role="staff",
        full_name=full_name.strip(),
        is_active=True,
    )
    db.add(staff)
    db.flush()

    log_audit(
        db=db,
        actor_id=admin_user.id,
        action="staff.created",
        entity_type="user",
        entity_id=staff.id,
        after={"email": staff.email, "role": staff.role},
        request_id=request_id,
    )
    db.commit()
    db.refresh(staff)
    return staff
