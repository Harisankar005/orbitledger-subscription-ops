from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.clock import clock
from app.db import get_db
from app.deps import require_roles
from app.errors import NotFoundError
from app.models.billing import DiscountRule
from app.models.identity import User
from app.schemas.discount import DiscountRuleCreate, DiscountRuleResponse, DiscountRuleUpdate
from app.services import discount as discount_service
from app.services.audit import log_audit

router = APIRouter(prefix="/discounts", tags=["discounts"])


@router.get("", response_model=Dict[str, Any])
def list_discounts(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    scope: str = Query(None),
    is_active: bool = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    query = db.query(DiscountRule)
    if scope:
        query = query.filter(DiscountRule.scope == scope)
    if is_active is not None:
        query = query.filter(DiscountRule.is_active == is_active)

    total = query.count()
    items = query.order_by(DiscountRule.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    today = clock.today()
    results = []
    for r in items:
        resp = DiscountRuleResponse.model_validate(r)
        resp.status_label = discount_service.derive_discount_status(r, today)
        results.append(resp)

    return {
        "items": results,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{rule_id}", response_model=DiscountRuleResponse)
def get_discount(
    rule_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    rule = db.query(DiscountRule).filter(DiscountRule.id == rule_id).first()
    if not rule:
        raise NotFoundError("Discount rule not found")
    resp = DiscountRuleResponse.model_validate(rule)
    resp.status_label = discount_service.derive_discount_status(rule, clock.today())
    return resp


@router.post("", response_model=DiscountRuleResponse, status_code=status.HTTP_201_CREATED)
def create_discount(
    req: DiscountRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    rule = discount_service.create_discount_rule(db, req, current_user.id, req_id)
    resp = DiscountRuleResponse.model_validate(rule)
    resp.status_label = discount_service.derive_discount_status(rule, clock.today())
    return resp


@router.patch("/{rule_id}", response_model=DiscountRuleResponse)
def update_discount(
    rule_id: int,
    req: DiscountRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    rule = discount_service.update_discount_rule(db, rule_id, req, current_user.id, req_id)
    resp = DiscountRuleResponse.model_validate(rule)
    resp.status_label = discount_service.derive_discount_status(rule, clock.today())
    return resp


@router.post("/{rule_id}/toggle", response_model=DiscountRuleResponse)
def toggle_discount(
    rule_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    """Admin-only: Toggle discount rule active status."""
    req_id = getattr(request.state, "request_id", None)
    rule = db.query(DiscountRule).filter(DiscountRule.id == rule_id).first()
    if not rule:
        raise NotFoundError("Discount rule not found")

    before_active = rule.is_active
    rule.is_active = not rule.is_active
    db.commit()
    db.refresh(rule)

    log_audit(
        db=db,
        actor_id=current_user.id,
        action="discount.toggled",
        entity_type="discount_rule",
        entity_id=rule.id,
        before={"is_active": before_active},
        after={"is_active": rule.is_active},
        request_id=req_id,
    )

    resp = DiscountRuleResponse.model_validate(rule)
    resp.status_label = discount_service.derive_discount_status(rule, clock.today())
    return resp
