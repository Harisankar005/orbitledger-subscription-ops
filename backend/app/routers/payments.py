from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.errors import ValidationError
from app.models.billing import Payment
from app.models.identity import User
from app.schemas.invoice import PaymentResponse
from app.schemas.payment import PaymentCreate
from app.services import payment as payment_service

router = APIRouter(tags=["payments"])


@router.post("/payments", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
def record_payment_direct(
    req: PaymentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    if not req.invoice_id:
        raise ValidationError("invoice_id is required", fields={"invoice_id": "Must specify invoice_id"})
    req_id = getattr(request.state, "request_id", None)
    payment = payment_service.record_payment(
        db=db,
        invoice_id=req.invoice_id,
        req=req,
        actor_id=current_user.id,
        idempotency_key=idempotency_key,
        request_id=req_id,
    )
    return PaymentResponse.model_validate(payment)


@router.get("/payments", response_model=Dict[str, Any])
def list_payments(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    invoice_id: Optional[int] = Query(None),
    method: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    query = db.query(Payment)
    if invoice_id:
        query = query.filter(Payment.invoice_id == invoice_id)
    if method:
        query = query.filter(Payment.method == method)

    total = query.count()
    items = (
        query.order_by(Payment.paid_on.desc(), Payment.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "items": [PaymentResponse.model_validate(p) for p in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/invoices/{invoice_id}/payments", response_model=PaymentResponse, status_code=status.HTTP_201_CREATED)
def record_invoice_payment(
    invoice_id: int,
    req: PaymentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    req_id = getattr(request.state, "request_id", None)
    payment = payment_service.record_payment(
        db=db,
        invoice_id=invoice_id,
        req=req,
        actor_id=current_user.id,
        idempotency_key=idempotency_key,
        request_id=req_id,
    )
    return PaymentResponse.model_validate(payment)
