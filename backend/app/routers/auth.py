from typing import Optional

from fastapi import APIRouter, Cookie, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models.identity import User
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserResponse,
)
from app.services.auth import (
    login_user,
    logout_user,
    register_customer,
    request_password_reset,
    reset_password,
    rotate_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "brightloop_refresh"


def set_refresh_cookie(response: Response, raw_token: str):
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        secure=False,  # Set to True in production HTTPS
        samesite="lax",
        path="/api/auth",
        max_age=7 * 24 * 3600,
    )


def clear_refresh_cookie(response: Response):
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/api/auth",
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    req: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    req_id = getattr(request.state, "request_id", None)
    user, _ = register_customer(db, req, req_id)
    # Log in user immediately upon registration
    access_token, raw_refresh, _ = login_user(db, req.email, req.password, req_id)
    set_refresh_cookie(response, raw_refresh)
    return TokenResponse(
        access_token=access_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    req_id = getattr(request.state, "request_id", None)
    access_token, raw_refresh, user = login_user(db, req.email, req.password, req_id)
    set_refresh_cookie(response, raw_refresh)
    return TokenResponse(
        access_token=access_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    brightloop_refresh: Optional[str] = Cookie(None),
):
    req_id = getattr(request.state, "request_id", None)
    if not brightloop_refresh:
        # Check authorization or custom header fallback
        brightloop_refresh = request.headers.get("X-Refresh-Token")

    access_token, new_raw, user = rotate_refresh_token(db, brightloop_refresh or "", req_id)
    set_refresh_cookie(response, new_raw)
    return TokenResponse(
        access_token=access_token,
        user=UserResponse.model_validate(user),
    )


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    brightloop_refresh: Optional[str] = Cookie(None),
):
    logout_user(db, brightloop_refresh)
    clear_refresh_cookie(response)
    return {"message": "Logged out successfully"}


@router.post("/forgot-password")
def forgot_password(
    req: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    req_id = getattr(request.state, "request_id", None)
    request_password_reset(db, req.email, req_id)
    return {"message": "If the email is registered, a password reset link has been queued."}


@router.post("/reset-password")
def reset_pw(
    req: ResetPasswordRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    req_id = getattr(request.state, "request_id", None)
    reset_password(db, req.token, req.new_password, req_id)
    clear_refresh_cookie(response)
    return {"message": "Password reset successfully. Please log in with your new credentials."}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse.model_validate(current_user)
