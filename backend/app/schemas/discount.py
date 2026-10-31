from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.catalog import ProductResponse


class DiscountRuleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    kind: Literal["fixed", "percent"] = "percent"
    value: Decimal = Field(..., ge=0)
    min_purchase_amount: Decimal = Field(Decimal("0.00"), ge=0)
    min_quantity: int = Field(0, ge=0)
    start_date: date
    end_date: date
    usage_limit: Optional[int] = Field(None, ge=1)
    scope: Literal["product", "subscription"] = "subscription"
    product_id: Optional[int] = None
    target_subscription_id: Optional[int] = None
    is_active: bool = True


class DiscountRuleCreate(DiscountRuleBase):
    pass


class DiscountRuleUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[Literal["fixed", "percent"]] = None
    value: Optional[Decimal] = Field(None, ge=0)
    min_purchase_amount: Optional[Decimal] = Field(None, ge=0)
    min_quantity: Optional[int] = Field(None, ge=0)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    usage_limit: Optional[int] = Field(None, ge=1)
    scope: Optional[Literal["product", "subscription"]] = None
    product_id: Optional[int] = None
    target_subscription_id: Optional[int] = None
    is_active: Optional[bool] = None


class DiscountRuleResponse(DiscountRuleBase):
    id: int
    used_count: int
    status_label: Optional[str] = None  # Derived: Active, Scheduled, Expired, Exhausted
    product: Optional[ProductResponse] = None

    model_config = ConfigDict(from_attributes=True)
