from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.errors import NotFoundError
from app.models.identity import User
from app.models.subscription import Subscription
from app.schemas.subscription import (
    SubscriptionCreate,
    SubscriptionFromTemplateRequest,
    SubscriptionResponse,
    SubscriptionTransitionRequest,
)
from app.services import subscription as sub_service

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


@router.get("", response_model=Dict[str, Any])
def list_subscriptions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(None),
    customer_id: int = Query(None),
    plan_id: int = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    query = db.query(Subscription)
    if status:
        query = query.filter(Subscription.status == status)
    if customer_id:
        query = query.filter(Subscription.customer_id == customer_id)
    if plan_id:
        query = query.filter(Subscription.plan_id == plan_id)

    total = query.count()
    items = (
        query.order_by(Subscription.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "items": [SubscriptionResponse.model_validate(s) for s in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{sub_id}", response_model=SubscriptionResponse)
def get_subscription(
    sub_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
    if not sub:
        raise NotFoundError("Subscription not found")
    return SubscriptionResponse.model_validate(sub)


@router.post("", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED)
def create_subscription(
    req: SubscriptionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    req_id = getattr(request.state, "request_id", None)
    sub = sub_service.create_subscription(db, req, current_user.id, req_id)
    return SubscriptionResponse.model_validate(sub)


@router.post("/from-template/{template_id}", response_model=SubscriptionResponse, status_code=status.HTTP_201_CREATED)
def create_from_template(
    template_id: int,
    req: SubscriptionFromTemplateRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    req_id = getattr(request.state, "request_id", None)
    sub = sub_service.create_from_template(
        db=db,
        template_id=template_id,
        customer_id=req.customer_id,
        start_date=req.start_date,
        expiry_date=req.expiry_date,
        notes=req.notes,
        actor_id=current_user.id,
        request_id=req_id,
    )
    return SubscriptionResponse.model_validate(sub)


@router.post("/{sub_id}/transition", response_model=SubscriptionResponse)
def transition_subscription(
    sub_id: int,
    req: SubscriptionTransitionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    req_id = getattr(request.state, "request_id", None)
    sub = sub_service.transition_subscription(
        db=db,
        subscription_id=sub_id,
        target_status=req.target_status,
        actor_id=current_user.id,
        reason=req.reason,
        expected_version=req.expected_version,
        request_id=req_id,
    )
    return SubscriptionResponse.model_validate(sub)


@router.post("/{sub_id}/renew", response_model=SubscriptionResponse)
def renew_subscription(
    sub_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    req_id = getattr(request.state, "request_id", None)
    new_sub = sub_service.renew_subscription(
        db=db,
        subscription_id=sub_id,
        actor_id=current_user.id,
        request_id=req_id,
    )
    return SubscriptionResponse.model_validate(new_sub)
