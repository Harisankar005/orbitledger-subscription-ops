import asyncio
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.clock import clock
from app.errors import ConflictError, NotFoundError, ValidationError
from app.events import broadcaster
from app.models.billing import Invoice, Payment
from app.schemas.payment import PaymentCreate
from app.services.audit import log_audit
from app.services.tax import round_money


def record_payment(
    db: Session,
    invoice_id: int,
    req: PaymentCreate,
    actor_id: Optional[int] = None,
    idempotency_key: Optional[str] = None,
    request_id: Optional[str] = None,
) -> Payment:
    """Record payment against a confirmed invoice with row locking and idempotency protection (PLAN.md 5.7)."""
    clean_idempotency = idempotency_key or req.idempotency_key
    if clean_idempotency:
        existing = db.query(Payment).filter(Payment.idempotency_key == clean_idempotency.strip()).first()
        if existing:
            return existing

    today = clock.today()
    if req.paid_on > today:
        raise ValidationError("Payment date cannot be in the future", fields={"paid_on": f"Cannot exceed {today}"})

    # Lock invoice row to prevent concurrent race conditions
    query = db.query(Invoice).filter(Invoice.id == invoice_id)
    if db.bind and db.bind.dialect.name == "postgresql":
        query = query.with_for_update()

    inv = query.first()
    if not inv:
        raise NotFoundError("Invoice not found")

    if inv.status != "confirmed":
        if inv.status == "draft":
            raise ConflictError("Payments can only be recorded against confirmed invoices", code="INVOICE_NOT_CONFIRMED")
        elif inv.status == "paid":
            raise ConflictError("This invoice is already fully paid", code="INVOICE_ALREADY_PAID")
        elif inv.status == "cancelled":
            raise ConflictError("Cannot record payments on a cancelled invoice", code="INVOICE_CANCELLED")

    amount = round_money(req.amount)
    if amount <= Decimal("0.00"):
        raise ValidationError("Payment amount must be strictly greater than 0")

    outstanding = inv.total - inv.amount_paid
    if amount > outstanding:
        raise ValidationError(
            f"Payment amount ({amount}) exceeds remaining balance ({outstanding:.2f})",
            fields={"amount": f"Maximum allowed payment is {outstanding:.2f}"},
        )

    payment = Payment(
        invoice_id=inv.id,
        method=req.method,
        amount=amount,
        paid_on=req.paid_on,
        note=req.note,
        recorded_by=actor_id,
        idempotency_key=clean_idempotency.strip() if clean_idempotency else None,
    )
    db.add(payment)

    # Update invoice state
    inv.amount_paid = round_money(inv.amount_paid + amount)
    inv.version += 1
    if inv.amount_paid >= inv.total:
        inv.status = "paid"

    log_audit(
        db=db,
        actor_id=actor_id,
        action="payment.recorded",
        entity_type="payment",
        entity_id=inv.id,
        after={
            "invoice_number": inv.number,
            "payment_amount": str(amount),
            "amount_paid": str(inv.amount_paid),
            "status": inv.status,
        },
        request_id=request_id,
    )

    db.commit()
    db.refresh(payment)

    # Broadcast real-time SSE event
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(
                broadcaster.broadcast(
                    "payment.recorded",
                    {
                        "invoice_id": inv.id,
                        "invoice_number": inv.number,
                        "amount": str(amount),
                        "invoice_status": inv.status,
                    },
                )
            )
    except Exception:
        pass

    return payment
