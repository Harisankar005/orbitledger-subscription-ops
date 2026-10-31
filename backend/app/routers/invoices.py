from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.clock import clock
from app.db import get_db
from app.deps import require_roles
from app.errors import NotFoundError
from app.models.billing import Invoice
from app.models.identity import User
from app.schemas.invoice import (
    BulkInvoiceActionRequest,
    BulkInvoiceActionResult,
    InvoiceResponse,
)
from app.services import invoice as invoice_service

router = APIRouter(prefix="/invoices", tags=["invoices"])


@router.get("", response_model=Dict[str, Any])
def list_invoices(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str = Query(None),
    payment_status: str = Query(None),
    customer_id: int = Query(None),
    subscription_id: int = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    query = db.query(Invoice)
    if status:
        query = query.filter(Invoice.status == status)
    if customer_id:
        query = query.filter(Invoice.customer_id == customer_id)
    if subscription_id:
        query = query.filter(Invoice.subscription_id == subscription_id)

    total = query.count()
    items = (
        query.order_by(Invoice.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    today = clock.today()
    results = []
    for inv in items:
        resp = InvoiceResponse.model_validate(inv)
        resp.payment_status = invoice_service.derive_payment_status(inv, today)
        if not payment_status or resp.payment_status.lower() == payment_status.lower():
            results.append(resp)

    return {
        "items": results,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise NotFoundError("Invoice not found")
    resp = InvoiceResponse.model_validate(inv)
    resp.payment_status = invoice_service.derive_payment_status(inv, clock.today())
    return resp


@router.post("/{invoice_id}/confirm", response_model=InvoiceResponse)
def confirm_invoice(
    invoice_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
    expected_version: Optional[int] = Query(None),
):
    req_id = getattr(request.state, "request_id", None)
    inv = invoice_service.confirm_invoice(db, invoice_id, current_user.id, expected_version, req_id)
    resp = InvoiceResponse.model_validate(inv)
    resp.payment_status = invoice_service.derive_payment_status(inv, clock.today())
    return resp


@router.post("/{invoice_id}/cancel", response_model=InvoiceResponse)
def cancel_invoice(
    invoice_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
    reason: Optional[str] = Query(None),
):
    req_id = getattr(request.state, "request_id", None)
    inv = invoice_service.cancel_invoice(db, invoice_id, current_user.id, reason, req_id)
    resp = InvoiceResponse.model_validate(inv)
    resp.payment_status = invoice_service.derive_payment_status(inv, clock.today())
    return resp


@router.post("/{invoice_id}/send", response_model=InvoiceResponse)
def send_invoice(
    invoice_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    req_id = getattr(request.state, "request_id", None)
    inv = invoice_service.send_invoice(db, invoice_id, current_user.id, req_id)
    resp = InvoiceResponse.model_validate(inv)
    resp.payment_status = invoice_service.derive_payment_status(inv, clock.today())
    return resp


@router.post("/bulk", response_model=BulkInvoiceActionResult)
def bulk_invoices(
    req: BulkInvoiceActionRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    req_id = getattr(request.state, "request_id", None)
    return invoice_service.bulk_invoice_action(db, req.invoice_ids, req.action, current_user.id, req_id)


@router.get("/{invoice_id}/print", response_class=HTMLResponse)
def print_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise NotFoundError("Invoice not found")
    html_content = invoice_service.generate_invoice_html(inv)
    return HTMLResponse(content=html_content)
