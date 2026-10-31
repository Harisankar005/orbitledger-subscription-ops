from typing import Any, Dict

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.clock import clock
from app.db import get_db
from app.deps import get_customer_scope
from app.errors import ConflictError, NotFoundError
from app.models.billing import Invoice
from app.models.identity import Customer
from app.models.subscription import Subscription
from app.schemas.auth import CustomerResponse
from app.schemas.invoice import InvoiceResponse
from app.schemas.subscription import SubscriptionResponse, SubscriptionTransitionRequest
from app.services import invoice as invoice_service
from app.services import subscription as sub_service

router = APIRouter(prefix="/portal", tags=["portal"])


@router.get("/subscriptions", response_model=Dict[str, Any])
def list_my_subscriptions(
    customer: Customer = Depends(get_customer_scope),
    db: Session = Depends(get_db),
):
    subs = db.query(Subscription).filter(Subscription.customer_id == customer.id).order_by(Subscription.id.desc()).all()
    return {
        "items": [SubscriptionResponse.model_validate(s) for s in subs],
        "total": len(subs),
    }


@router.get("/subscriptions/{sub_id}", response_model=SubscriptionResponse)
def get_my_subscription(
    sub_id: int,
    customer: Customer = Depends(get_customer_scope),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter(Subscription.id == sub_id, Subscription.customer_id == customer.id).first()
    if not sub:
        raise NotFoundError("Subscription not found")
    return SubscriptionResponse.model_validate(sub)


@router.post("/subscriptions/{sub_id}/transition", response_model=SubscriptionResponse)
def transition_my_subscription(
    sub_id: int,
    req: SubscriptionTransitionRequest,
    request: Request,
    customer: Customer = Depends(get_customer_scope),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter(Subscription.id == sub_id, Subscription.customer_id == customer.id).first()
    if not sub:
        raise NotFoundError("Subscription not found")

    # Customers may only initiate pause or close, and only if plan permits
    if req.target_status not in ("paused", "closed", "active"):
        raise ConflictError(f"Customer cannot transition subscription to '{req.target_status}'")

    req_id = getattr(request.state, "request_id", None)
    res = sub_service.transition_subscription(
        db=db,
        subscription_id=sub.id,
        target_status=req.target_status,
        actor_id=customer.user_id,
        reason=req.reason or "Customer portal request",
        expected_version=req.expected_version,
        request_id=req_id,
    )
    return SubscriptionResponse.model_validate(res)


@router.get("/invoices", response_model=Dict[str, Any])
def list_my_invoices(
    customer: Customer = Depends(get_customer_scope),
    db: Session = Depends(get_db),
):
    invoices = db.query(Invoice).filter(Invoice.customer_id == customer.id).order_by(Invoice.created_at.desc()).all()
    today = clock.today()
    results = []
    total_outstanding = 0.0

    for inv in invoices:
        resp = InvoiceResponse.model_validate(inv)
        resp.payment_status = invoice_service.derive_payment_status(inv, today)
        results.append(resp)
        if inv.status == "confirmed" and inv.amount_paid < inv.total:
            total_outstanding += float(inv.total - inv.amount_paid)

    return {
        "items": results,
        "total": len(invoices),
        "total_outstanding": round(total_outstanding, 2),
    }


@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
def get_my_invoice(
    invoice_id: int,
    customer: Customer = Depends(get_customer_scope),
    db: Session = Depends(get_db),
):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id, Invoice.customer_id == customer.id).first()
    if not inv:
        raise NotFoundError("Invoice not found")
    resp = InvoiceResponse.model_validate(inv)
    resp.payment_status = invoice_service.derive_payment_status(inv, clock.today())
    return resp


@router.get("/invoices/{invoice_id}/print", response_class=HTMLResponse)
def print_my_invoice(
    invoice_id: int,
    customer: Customer = Depends(get_customer_scope),
    db: Session = Depends(get_db),
):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id, Invoice.customer_id == customer.id).first()
    if not inv:
        raise NotFoundError("Invoice not found")
    return HTMLResponse(content=invoice_service.generate_invoice_html(inv))


@router.get("/profile", response_model=CustomerResponse)
def get_my_profile(
    customer: Customer = Depends(get_customer_scope),
):
    return CustomerResponse.model_validate(customer)
