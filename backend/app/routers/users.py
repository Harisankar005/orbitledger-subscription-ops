from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.errors import NotFoundError
from app.models.identity import User
from app.schemas.auth import StaffCreateRequest, UserResponse, UserUpdateRequest
from app.services.audit import log_audit
from app.services.auth import create_staff_user

router = APIRouter(prefix="/users", tags=["users"])


@router.post("/staff", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_staff(
    req: StaffCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    staff = create_staff_user(db, current_user, req.email, req.password, req.full_name, req_id)
    return UserResponse.model_validate(staff)


@router.get("", response_model=Dict[str, Any])
def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    role: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)

    total = query.count()
    users = (
        query.order_by(User.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "items": [UserResponse.model_validate(u) for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    req: UserUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise NotFoundError("User not found")

    before = {"full_name": user.full_name, "is_active": user.is_active, "role": user.role}

    if req.full_name is not None:
        user.full_name = req.full_name.strip()
    if req.is_active is not None:
        user.is_active = req.is_active
    if req.role is not None and req.role in ("admin", "staff", "customer"):
        user.role = req.role

    after = {"full_name": user.full_name, "is_active": user.is_active, "role": user.role}

    req_id = getattr(request.state, "request_id", None)
    log_audit(
        db=db,
        actor_id=current_user.id,
        action="user.updated",
        entity_type="user",
        entity_id=user.id,
        before=before,
        after=after,
        request_id=req_id,
    )

    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)
