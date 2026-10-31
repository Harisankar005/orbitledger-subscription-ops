from datetime import date
from decimal import Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class ProductVariantBase(BaseModel):
    attribute: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., min_length=1, max_length=100)
    extra_price: Decimal = Field(default=Decimal("0.00"))


class ProductVariantCreate(ProductVariantBase):
    pass


class ProductVariantResponse(ProductVariantBase):
    id: int
    product_id: int

    model_config = ConfigDict(from_attributes=True)


class ProductBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    type: Literal["software", "addon", "service", "physical"]
    sales_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    cost_price: Decimal = Field(default=Decimal("0.00"), ge=0)
    notes: Optional[str] = None
    default_tax_id: Optional[int] = None
    is_active: bool = True


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[Literal["software", "addon", "service", "physical"]] = None
    sales_price: Optional[Decimal] = Field(None, ge=0)
    cost_price: Optional[Decimal] = Field(None, ge=0)
    notes: Optional[str] = None
    default_tax_id: Optional[int] = None
    is_active: Optional[bool] = None


class ProductResponse(ProductBase):
    id: int
    variants: List[ProductVariantResponse] = []

    model_config = ConfigDict(from_attributes=True)


class TaxBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    kind: Literal["percent", "fixed"] = "percent"
    rate: Decimal = Field(..., ge=0)
    is_active: bool = True


class TaxCreate(TaxBase):
    pass


class TaxUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[Literal["percent", "fixed"]] = None
    rate: Optional[Decimal] = Field(None, ge=0)
    is_active: Optional[bool] = None


class TaxResponse(TaxBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class TaxRuleBase(BaseModel):
    product_type: Optional[Literal["software", "addon", "service", "physical"]] = None
    tax_id: int
    priority: int = 10
    is_active: bool = True


class TaxRuleCreate(TaxRuleBase):
    pass


class TaxRuleUpdate(BaseModel):
    product_type: Optional[Literal["software", "addon", "service", "physical"]] = None
    tax_id: Optional[int] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class TaxRuleResponse(TaxRuleBase):
    id: int
    tax: Optional[TaxResponse] = None

    model_config = ConfigDict(from_attributes=True)


class PaymentTermBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    days: int = Field(0, ge=0)


class PaymentTermCreate(PaymentTermBase):
    pass


class PaymentTermResponse(PaymentTermBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class PlanBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    price: Decimal = Field(..., ge=0)
    billing_period: Literal["daily", "weekly", "monthly", "yearly"] = "monthly"
    min_quantity: int = Field(0, ge=0)
    available_from: date
    available_to: date
    default_tax_id: Optional[int] = None
    auto_close_on_end: bool = True
    allow_early_close: bool = True
    allow_pause: bool = True
    allow_renew: bool = True


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[Decimal] = Field(None, ge=0)
    billing_period: Optional[Literal["daily", "weekly", "monthly", "yearly"]] = None
    min_quantity: Optional[int] = Field(None, ge=0)
    available_from: Optional[date] = None
    available_to: Optional[date] = None
    default_tax_id: Optional[int] = None
    auto_close_on_end: Optional[bool] = None
    allow_early_close: Optional[bool] = None
    allow_pause: Optional[bool] = None
    allow_renew: Optional[bool] = None


class PlanResponse(PlanBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


class QuotationTemplateLineBase(BaseModel):
    product_id: int
    variant_id: Optional[int] = None
    quantity: int = Field(1, ge=1)


class QuotationTemplateLineCreate(QuotationTemplateLineBase):
    pass


class QuotationTemplateLineResponse(QuotationTemplateLineBase):
    id: int
    product: Optional[ProductResponse] = None

    model_config = ConfigDict(from_attributes=True)


class QuotationTemplateBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    plan_id: int
    validity_days: int = Field(30, ge=1)
    payment_term_id: int
    is_active: bool = True


class QuotationTemplateCreate(QuotationTemplateBase):
    lines: List[QuotationTemplateLineCreate] = []


class QuotationTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    plan_id: Optional[int] = None
    validity_days: Optional[int] = Field(None, ge=1)
    payment_term_id: Optional[int] = None
    is_active: Optional[bool] = None
    lines: Optional[List[QuotationTemplateLineCreate]] = None


class QuotationTemplateResponse(QuotationTemplateBase):
    id: int
    plan: Optional[PlanResponse] = None
    payment_term: Optional[PaymentTermResponse] = None
    lines: List[QuotationTemplateLineResponse] = []

    model_config = ConfigDict(from_attributes=True)
