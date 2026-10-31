from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.auth import CustomerResponse
from app.schemas.catalog import ProductResponse, TaxResponse


class InvoiceLineResponse(BaseModel):
    id: int
    invoice_id: int
    source: str
    product_id: Optional[int]
    description: str
    quantity: int
    unit_price: Decimal
    discount_amount: Decimal
    tax_id: Optional[int]
    tax_amount: Decimal
    line_total: Decimal
    product: Optional[ProductResponse] = None
    tax: Optional[TaxResponse] = None

    model_config = ConfigDict(from_attributes=True)


class AppliedDiscountResponse(BaseModel):
    id: int
    invoice_id: int
    invoice_line_id: Optional[int]
    discount_rule_id: int
    amount: Decimal

    model_config = ConfigDict(from_attributes=True)


class PaymentResponse(BaseModel):
    id: int
    invoice_id: int
    method: str
    amount: Decimal
    paid_on: date
    note: Optional[str]
    recorded_by: Optional[int]
    idempotency_key: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvoiceResponse(BaseModel):
    id: int
    number: str
    subscription_id: int
    customer_id: int
    period_start: date
    period_end: date
    issue_date: date
    due_date: date
    status: str
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    amount_paid: Decimal
    currency: str
    sent_at: Optional[datetime]
    version: int
    created_at: datetime
    updated_at: datetime

    # Computed derived status
    payment_status: Optional[str] = None  # Draft, Paid, Partially paid, Outstanding, Overdue, Cancelled
    days_overdue: Optional[int] = None
    amount_due: Optional[Decimal] = None

    customer: Optional[CustomerResponse] = None
    lines: List[InvoiceLineResponse] = []
    applied_discounts: List[AppliedDiscountResponse] = []
    payments: List[PaymentResponse] = []

    model_config = ConfigDict(from_attributes=True)


class BulkInvoiceActionRequest(BaseModel):
    invoice_ids: List[int] = Field(..., min_length=1)
    action: Literal["confirm", "send"]


class BulkInvoiceItemResult(BaseModel):
    id: int
    success: bool
    status: Optional[str] = None
    error: Optional[str] = None


class BulkInvoiceActionResult(BaseModel):
    total_processed: int
    succeeded: int
    failed: int
    results: List[BulkInvoiceItemResult]
