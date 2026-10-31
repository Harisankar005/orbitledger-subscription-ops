from datetime import datetime, timezone
from typing import Callable, Optional

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import ForbiddenError, NotFoundError, UnauthorizedError
from app.models.identity import Customer, User
from app.security import decode_access_token


def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Extract and validate the currently authenticated user from Bearer JWT."""
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError("Missing or invalid Authorization header")

    token = authorization.split(" ")[1]
    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user:
        raise UnauthorizedError("User does not exist")
    if not user.is_active:
        raise ForbiddenError("Account is inactive")
    if user.locked_until and user.locked_until > datetime.now(timezone.utc):
        raise ForbiddenError("Account is temporarily locked due to excessive failed attempts")

    # Store user in request state for downstream handlers
    request.state.current_user = user
    return user


def require_roles(*allowed_roles: str) -> Callable[[User], User]:
    """Dependency factory enforcing server-side Role-Based Access Control."""
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise ForbiddenError(f"Access restricted to roles: {', '.join(allowed_roles)}")
        return current_user

    return role_checker


def get_customer_scope(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Optional[Customer]:
    """Resolve Customer scope. If user is a customer, return their customer record.

    If customer attempts to query other customer data, 404 is returned to prevent enumeration.
    Staff and Admins have unrestricted visibility.
    """
    if current_user.role == "customer":
        customer = db.query(Customer).filter(Customer.user_id == current_user.id).first()
        if not customer:
            raise NotFoundError("Customer profile not linked to user")
        return customer
    return None
