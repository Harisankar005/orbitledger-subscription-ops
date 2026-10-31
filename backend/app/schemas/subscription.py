from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.auth import CustomerResponse
from app.schemas.catalog import (
    PaymentTermResponse,
    PlanResponse,
    ProductResponse,
    ProductVariantResponse,
    TaxResponse,
)


class SubscriptionLineCreate(BaseModel):
    product_id: int
    variant_id: Optional[int] = None
    quantity: int = Field(1, ge=1)
    description: Optional[str] = None
    unit_price: Optional[Decimal] = Field(None, ge=0)
    tax_id: Optional[int] = None


class SubscriptionLineResponse(BaseModel):
    id: int
    subscription_id: int
    product_id: int
    variant_id: Optional[int]
    description: str
    quantity: int
    unit_price: Decimal
    tax_id: Optional[int]
    amount: Decimal
    product: Optional[ProductResponse] = None
    variant: Optional[ProductVariantResponse] = None
    tax: Optional[TaxResponse] = None

    model_config = ConfigDict(from_attributes=True)


class SubscriptionStatusHistoryResponse(BaseModel):
    id: int
    from_status: str
    to_status: str
    changed_by: Optional[int]
    changed_at: datetime
    reason: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class SubscriptionBase(BaseModel):
    customer_id: int
    plan_id: int
    start_date: date
    expiry_date: date
    payment_term_id: Optional[int] = None
    notes: Optional[str] = None


class SubscriptionCreate(SubscriptionBase):
    template_id: Optional[int] = None
    lines: List[SubscriptionLineCreate] = []


class SubscriptionFromTemplateRequest(BaseModel):
    customer_id: int
    start_date: date
    expiry_date: date
    notes: Optional[str] = None


class SubscriptionUpdate(BaseModel):
    payment_term_id: Optional[int] = None
    notes: Optional[str] = None


class SubscriptionTransitionRequest(BaseModel):
    target_status: Literal["draft", "quotation", "confirmed", "active", "paused", "closed"]
    reason: Optional[str] = None
    expected_version: Optional[int] = None


class SubscriptionResponse(BaseModel):
    id: int
    number: str
    customer_id: int
    plan_id: int
    template_id: Optional[int]
    status: str
    start_date: date
    expiry_date: date
    payment_term_id: int
    quotation_valid_until: Optional[date]
    billing_anchor: date
    periods_billed: int
    next_invoice_date: date
    currency: str
    notes: Optional[str]
    version: int
    created_at: datetime
    updated_at: datetime

    customer: Optional[CustomerResponse] = None
    plan: Optional[PlanResponse] = None
    payment_term: Optional[PaymentTermResponse] = None
    lines: List[SubscriptionLineResponse] = []
    status_history: List[SubscriptionStatusHistoryResponse] = []

    model_config = ConfigDict(from_attributes=True)
