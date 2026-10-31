from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.clock import clock
from app.errors import ConflictError, IllegalTransitionError, NotFoundError, ValidationError
from app.models.catalog import Plan, Product, ProductVariant, QuotationTemplate
from app.models.identity import Customer
from app.models.subscription import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatusHistory,
)
from app.schemas.subscription import (
    SubscriptionCreate,
    SubscriptionLineCreate,
)
from app.services.audit import log_audit
from app.services.numbering import generate_next_number
from app.services.tax import resolve_line_tax, round_money


def _calculate_line_price(product: Product, variant: Optional[ProductVariant]) -> Decimal:
    """Line unit_price = product.sales_price + variant.extra_price (PLAN.md 5.2)."""
    price = product.sales_price
    if variant:
        price += variant.extra_price
    return round_money(price)


def create_subscription(
    db: Session,
    req: SubscriptionCreate,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
) -> Subscription:
    """Create a new subscription in draft status."""
    customer = db.query(Customer).filter(Customer.id == req.customer_id).first()
    if not customer:
        raise NotFoundError("Customer not found")

    plan = db.query(Plan).filter(Plan.id == req.plan_id).first()
    if not plan:
        raise NotFoundError("Plan not found")

    if req.start_date > req.expiry_date:
        raise ValidationError("start_date cannot be after expiry_date", fields={"start_date": "Must precede expiry_date"})

    payment_term_id = req.payment_term_id or 1  # default to immediate / first term
    sub_number = generate_next_number(db, "SUB")

    sub = Subscription(
        number=sub_number,
        customer_id=req.customer_id,
        plan_id=req.plan_id,
        template_id=req.template_id,
        status="draft",
        start_date=req.start_date,
        expiry_date=req.expiry_date,
        payment_term_id=payment_term_id,
        billing_anchor=req.start_date,
        periods_billed=0,
        next_invoice_date=req.start_date,
        currency="INR",
        notes=req.notes,
        version=1,
    )
    db.add(sub)
    db.flush()

    for line_req in req.lines:
        add_subscription_line(db, sub, line_req)

    history = SubscriptionStatusHistory(
        subscription_id=sub.id,
        from_status="none",
        to_status="draft",
        changed_by=actor_id,
        reason="Initial draft creation",
    )
    db.add(history)

    log_audit(
        db=db,
        actor_id=actor_id,
        action="subscription.created",
        entity_type="subscription",
        entity_id=sub.id,
        after={"number": sub.number, "status": sub.status, "customer_id": sub.customer_id},
        request_id=request_id,
    )

    db.commit()
    db.refresh(sub)
    return sub


def create_from_template(
    db: Session,
    template_id: int,
    customer_id: int,
    start_date: date,
    expiry_date: date,
    notes: Optional[str] = None,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
) -> Subscription:
    """Create a subscription pre-populated from a quotation template."""
    tpl = db.query(QuotationTemplate).filter(QuotationTemplate.id == template_id).first()
    if not tpl:
        raise NotFoundError("Quotation template not found")

    lines_create = [
        SubscriptionLineCreate(
            product_id=tl.product_id,
            variant_id=tl.variant_id,
            quantity=tl.quantity,
        )
        for tl in tpl.lines
    ]

    req = SubscriptionCreate(
        customer_id=customer_id,
        plan_id=tpl.plan_id,
        start_date=start_date,
        expiry_date=expiry_date,
        payment_term_id=tpl.payment_term_id,
        template_id=tpl.id,
        notes=notes,
        lines=lines_create,
    )
    return create_subscription(db, req, actor_id, request_id)


def add_subscription_line(
    db: Session,
    sub: Subscription,
    req: SubscriptionLineCreate,
) -> SubscriptionLine:
    """Add a product line with price snapshot and resolved tax."""
    product = db.query(Product).filter(Product.id == req.product_id).first()
    if not product:
        raise NotFoundError(f"Product {req.product_id} not found")

    variant = None
    if req.variant_id:
        variant = db.query(ProductVariant).filter(
            ProductVariant.id == req.variant_id,
            ProductVariant.product_id == req.product_id,
        ).first()
        if not variant:
            raise NotFoundError("Product variant not found for this product")

    # Determine unit price (snapshot)
    if req.unit_price is not None:
        unit_price = round_money(req.unit_price)
    else:
        unit_price = _calculate_line_price(product, variant)

    # Determine resolved tax snapshot
    tax = resolve_line_tax(db, explicit_tax_id=req.tax_id, product=product)
    tax_id = tax.id if tax else None

    description = req.description or product.name
    if variant:
        description += f" ({variant.attribute}: {variant.value})"

    amount = round_money(unit_price * Decimal(req.quantity))

    line = SubscriptionLine(
        subscription_id=sub.id,
        product_id=product.id,
        variant_id=variant.id if variant else None,
        description=description,
        quantity=req.quantity,
        unit_price=unit_price,
        tax_id=tax_id,
        amount=amount,
    )
    db.add(line)
    return line


def transition_subscription(
    db: Session,
    subscription_id: int,
    target_status: str,
    actor_id: Optional[int] = None,
    reason: Optional[str] = None,
    expected_version: Optional[int] = None,
    request_id: Optional[str] = None,
) -> Subscription:
    """Single state machine transition function (PLAN.md 5.3).

    Enforces validation gates, optimism lock, status history, and audit logging.
    """
    sub = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not sub:
        raise NotFoundError("Subscription not found")

    current_status = sub.status

    # Optimistic locking check
    if expected_version is not None and sub.version != expected_version:
        raise ConflictError(
            "Subscription was modified by another operation. Please reload.",
            code="CONCURRENCY_CONFLICT",
        )

    # Legal transitions matrix
    legal_moves = {
        "draft": ["quotation"],
        "quotation": ["confirmed", "draft"],
        "confirmed": ["active"],
        "active": ["paused", "closed"],
        "paused": ["active", "closed"],
        "closed": [],
    }

    if target_status not in legal_moves.get(current_status, []):
        raise IllegalTransitionError(
            f"Cannot transition subscription from '{current_status}' to '{target_status}'. Legal moves: {legal_moves.get(current_status, [])}"
        )

    today = clock.today()
    plan = sub.plan

    # Specific Transition Gates
    if current_status == "draft" and target_status == "quotation":
        # 1. Needs >= 1 line
        if not sub.lines:
            raise ValidationError("Subscription must contain at least one line item to generate a quotation")

        # 2. Plan availability window check
        if sub.start_date < plan.available_from or sub.start_date > plan.available_to:
            raise ConflictError(
                f"Plan '{plan.name}' is only available from {plan.available_from} to {plan.available_to}. Start date {sub.start_date} is outside this range.",
                code="PLAN_UNAVAILABLE",
            )

        # 3. Plan min_quantity check across all product lines (D-002)
        total_quantity = sum(line.quantity for line in sub.lines)
        if total_quantity < plan.min_quantity:
            raise ValidationError(
                f"Total product quantity ({total_quantity}) does not meet the plan minimum required ({plan.min_quantity})",
                fields={"quantity": f"Plan requires minimum {plan.min_quantity} total units"},
            )

        # 4. Set quotation validity
        validity_days = 30
        if sub.template and sub.template.validity_days:
            validity_days = sub.template.validity_days
        sub.quotation_valid_until = today + timedelta(days=validity_days)

    elif current_status == "quotation" and target_status == "confirmed":
        # Check quotation expiry
        if sub.quotation_valid_until and sub.quotation_valid_until < today:
            raise ConflictError(
                f"Quotation expired on {sub.quotation_valid_until}. Please revise the quotation.",
                code="QUOTATION_EXPIRED",
            )

    elif current_status == "confirmed" and target_status == "active":
        sub.next_invoice_date = sub.start_date
        sub.billing_anchor = sub.start_date

    elif current_status == "active" and target_status == "paused":
        if not plan.allow_pause:
            raise ConflictError(
                f"Plan '{plan.name}' does not allow pausing subscriptions.",
                code="PAUSE_NOT_ALLOWED",
            )

    elif target_status == "closed":
        # Early close check
        if today < sub.expiry_date and not plan.allow_early_close:
            raise ConflictError(
                f"Plan '{plan.name}' does not permit early termination before expiry ({sub.expiry_date}).",
                code="EARLY_CLOSE_FORBIDDEN",
            )

    # Perform transition
    before_status = sub.status
    sub.status = target_status
    sub.version += 1

    history = SubscriptionStatusHistory(
        subscription_id=sub.id,
        from_status=before_status,
        to_status=target_status,
        changed_by=actor_id,
        reason=reason,
    )
    db.add(history)

    log_audit(
        db=db,
        actor_id=actor_id,
        action="subscription.transition",
        entity_type="subscription",
        entity_id=sub.id,
        before={"status": before_status},
        after={"status": target_status, "reason": reason},
        request_id=request_id,
    )

    db.commit()
    db.refresh(sub)
    return sub


def renew_subscription(
    db: Session,
    subscription_id: int,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
) -> Subscription:
    """Renew a subscription, creating a new subscription copying lines starting the day after expiry (PLAN.md 5.3)."""
    old_sub = db.query(Subscription).filter(Subscription.id == subscription_id).first()
    if not old_sub:
        raise NotFoundError("Subscription not found")

    if not old_sub.plan.allow_renew:
        raise ConflictError(f"Plan '{old_sub.plan.name}' does not permit renewals.", code="RENEWAL_NOT_ALLOWED")

    duration_days = (old_sub.expiry_date - old_sub.start_date).days
    new_start_date = old_sub.expiry_date + timedelta(days=1)
    new_expiry_date = new_start_date + timedelta(days=duration_days)

    lines_create = [
        SubscriptionLineCreate(
            product_id=line.product_id,
            variant_id=line.variant_id,
            quantity=line.quantity,
            description=line.description,
            unit_price=line.unit_price,
            tax_id=line.tax_id,
        )
        for line in old_sub.lines
    ]

    new_req = SubscriptionCreate(
        customer_id=old_sub.customer_id,
        plan_id=old_sub.plan_id,
        start_date=new_start_date,
        expiry_date=new_expiry_date,
        payment_term_id=old_sub.payment_term_id,
        template_id=old_sub.template_id,
        notes=f"Renewed from {old_sub.number}",
        lines=lines_create,
    )

    new_sub = create_subscription(db, new_req, actor_id, request_id)

    # Mark old subscription closed if it was active
    if old_sub.status in ("active", "paused", "confirmed"):
        transition_subscription(
            db=db,
            subscription_id=old_sub.id,
            target_status="closed",
            actor_id=actor_id,
            reason=f"Renewed as {new_sub.number}",
            request_id=request_id,
        )

    log_audit(
        db=db,
        actor_id=actor_id,
        action="subscription.renewed",
        entity_type="subscription",
        entity_id=old_sub.id,
        after={"renewed_into_subscription_id": new_sub.id, "new_number": new_sub.number},
        request_id=request_id,
    )

    db.commit()
    return new_sub
