from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, Field


class PaymentCreate(BaseModel):
    method: Literal["cash", "card", "upi", "bank_transfer", "cheque"]
    amount: Decimal = Field(..., gt=0)
    paid_on: date
    note: Optional[str] = None
    idempotency_key: Optional[str] = None
