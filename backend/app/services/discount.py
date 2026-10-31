from datetime import date
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.errors import ConflictError, NotFoundError, ValidationError
from app.models.billing import DiscountRule
from app.schemas.discount import DiscountRuleCreate, DiscountRuleUpdate
from app.services.audit import log_audit
from app.services.tax import round_money


def derive_discount_status(rule: DiscountRule, today: date) -> str:
    """Derive display status label: Active, Scheduled, Expired, Exhausted, or Inactive."""
    if not rule.is_active:
        return "Inactive"
    if rule.usage_limit is not None and rule.used_count >= rule.usage_limit:
        return "Exhausted"
    if today > rule.end_date:
        return "Expired"
    if today < rule.start_date:
        return "Scheduled"
    return "Active"


def create_discount_rule(
    db: Session,
    req: DiscountRuleCreate,
    actor_id: int,
    request_id: Optional[str] = None,
) -> DiscountRule:
    if db.query(DiscountRule).filter(DiscountRule.name == req.name.strip()).first():
        raise ConflictError("Discount rule with this name already exists")
    if req.start_date > req.end_date:
        raise ValidationError("start_date cannot be after end_date")
    if req.scope == "product" and not req.product_id:
        raise ValidationError("product_id is required for product-scoped discount rules")

    rule = DiscountRule(
        name=req.name.strip(),
        kind=req.kind,
        value=req.value,
        min_purchase_amount=req.min_purchase_amount,
        min_quantity=req.min_quantity,
        start_date=req.start_date,
        end_date=req.end_date,
        usage_limit=req.usage_limit,
        used_count=0,
        scope=req.scope,
        product_id=req.product_id,
        target_subscription_id=req.target_subscription_id,
        is_active=req.is_active,
    )
    db.add(rule)
    db.flush()

    log_audit(db, actor_id, "discount_rule.created", "discount_rule", rule.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(rule)
    return rule


def update_discount_rule(
    db: Session,
    rule_id: int,
    req: DiscountRuleUpdate,
    actor_id: int,
    request_id: Optional[str] = None,
) -> DiscountRule:
    rule = db.query(DiscountRule).filter(DiscountRule.id == rule_id).first()
    if not rule:
        raise NotFoundError("Discount rule not found")

    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(rule, k, v)

    if rule.start_date > rule.end_date:
        raise ValidationError("start_date cannot be after end_date")
    if rule.scope == "product" and not rule.product_id:
        raise ValidationError("product_id is required for product-scoped discount rules")

    log_audit(db, actor_id, "discount_rule.updated", "discount_rule", rule.id, after=update_data, request_id=request_id)
    db.commit()
    db.refresh(rule)
    return rule


def calculate_raw_deduction(rule: DiscountRule, base_amount: Decimal) -> Decimal:
    """Compute monetary deduction for rule on base amount; never exceeds base amount."""
    if base_amount <= 0 or rule.value <= 0:
        return Decimal("0.00")

    if rule.kind == "percent":
        deduction = (base_amount * rule.value) / Decimal("100")
    else:  # fixed
        deduction = rule.value

    deduction = min(deduction, base_amount)
    return round_money(deduction)


def try_claim_discount_usage(db: Session, rule_id: int) -> bool:
    """Atomically increment used_count if usage_limit is not exceeded (PLAN.md 5.5).

    Returns True if successfully claimed, False if exhausted.
    """
    stmt = (
        update(DiscountRule)
        .where(
            DiscountRule.id == rule_id,
            (DiscountRule.usage_limit.is_(None)) | (DiscountRule.used_count < DiscountRule.usage_limit),
        )
        .values(used_count=DiscountRule.used_count + 1)
    )
    res = db.execute(stmt)
    rowcount = getattr(res, "rowcount", 0)
    return rowcount > 0


def evaluate_product_line_discount(
    db: Session,
    product_id: int,
    quantity: int,
    line_amount: Decimal,
    as_of_date: date,
    preloaded_rules: Optional[List[DiscountRule]] = None,
) -> Optional[Tuple[DiscountRule, Decimal]]:
    """Find and return the single best eligible product discount rule and deduction (D-004)."""
    if preloaded_rules is not None:
        rules = [
            r
            for r in preloaded_rules
            if r.is_active
            and r.scope == "product"
            and r.product_id == product_id
            and r.start_date <= as_of_date <= r.end_date
            and r.min_quantity <= quantity
            and r.min_purchase_amount <= line_amount
            and (r.usage_limit is None or r.used_count < r.usage_limit)
        ]
    else:
        rules = (
            db.query(DiscountRule)
            .filter(
                DiscountRule.is_active.is_(True),
                DiscountRule.scope == "product",
                DiscountRule.product_id == product_id,
                DiscountRule.start_date <= as_of_date,
                DiscountRule.end_date >= as_of_date,
                DiscountRule.min_quantity <= quantity,
                DiscountRule.min_purchase_amount <= line_amount,
                (DiscountRule.usage_limit.is_(None)) | (DiscountRule.used_count < DiscountRule.usage_limit),
            )
            .all()
        )

    best_match: Optional[Tuple[DiscountRule, Decimal]] = None
    best_deduction = Decimal("0.00")

    for r in rules:
        ded = calculate_raw_deduction(r, line_amount)
        if ded > best_deduction:
            best_deduction = ded
            best_match = (r, ded)

    return best_match


def evaluate_subscription_discount(
    db: Session,
    subscription_id: int,
    total_quantity: int,
    post_line_subtotal: Decimal,
    as_of_date: date,
    preloaded_rules: Optional[List[DiscountRule]] = None,
) -> Optional[Tuple[DiscountRule, Decimal]]:
    """Find and return the single best eligible subscription-scoped discount rule on post-line subtotal (D-004)."""
    if preloaded_rules is not None:
        rules = [
            r
            for r in preloaded_rules
            if r.is_active
            and r.scope == "subscription"
            and (r.target_subscription_id is None or r.target_subscription_id == subscription_id)
            and r.start_date <= as_of_date <= r.end_date
            and r.min_quantity <= total_quantity
            and r.min_purchase_amount <= post_line_subtotal
            and (r.usage_limit is None or r.used_count < r.usage_limit)
        ]
    else:
        rules = (
            db.query(DiscountRule)
            .filter(
                DiscountRule.is_active.is_(True),
                DiscountRule.scope == "subscription",
                (DiscountRule.target_subscription_id.is_(None)) | (DiscountRule.target_subscription_id == subscription_id),
                DiscountRule.start_date <= as_of_date,
                DiscountRule.end_date >= as_of_date,
                DiscountRule.min_quantity <= total_quantity,
                DiscountRule.min_purchase_amount <= post_line_subtotal,
                (DiscountRule.usage_limit.is_(None)) | (DiscountRule.used_count < DiscountRule.usage_limit),
            )
            .all()
        )

    best_match: Optional[Tuple[DiscountRule, Decimal]] = None
    best_deduction = Decimal("0.00")

    for r in rules:
        ded = calculate_raw_deduction(r, post_line_subtotal)
        if ded > best_deduction:
            best_deduction = ded
            best_match = (r, ded)

    return best_match
