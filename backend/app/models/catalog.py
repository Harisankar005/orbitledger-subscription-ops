from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    sales_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    default_tax_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("taxes.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint("type IN ('software', 'addon', 'service', 'physical')", name="ck_product_type"),
        CheckConstraint("sales_price >= 0", name="ck_product_sales_price"),
        CheckConstraint("cost_price >= 0", name="ck_product_cost_price"),
    )

    # Relationships
    variants: Mapped[list["ProductVariant"]] = relationship("ProductVariant", back_populates="product", cascade="all, delete-orphan")
    default_tax: Mapped[Optional["Tax"]] = relationship("Tax", foreign_keys=[default_tax_id])


class ProductVariant(Base, TimestampMixin):
    __tablename__ = "product_variants"

    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False)
    attribute: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[str] = mapped_column(String(100), nullable=False)
    extra_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)

    __table_args__ = (
        UniqueConstraint("product_id", "attribute", "value", name="uq_product_variant_attr_val"),
    )

    product: Mapped["Product"] = relationship("Product", back_populates="variants")


class Tax(Base, TimestampMixin):
    __tablename__ = "taxes"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="percent", nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint("kind IN ('percent', 'fixed')", name="ck_tax_kind"),
        CheckConstraint("rate >= 0", name="ck_tax_rate"),
    )


class TaxRule(Base, TimestampMixin):
    __tablename__ = "tax_rules"

    product_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # NULL means any product type
    tax_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("taxes.id", ondelete="CASCADE"), index=True, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint("product_type IS NULL OR product_type IN ('software', 'addon', 'service', 'physical')", name="ck_tax_rule_product_type"),
    )

    tax: Mapped["Tax"] = relationship("Tax")


class PaymentTerm(Base, TimestampMixin):
    __tablename__ = "payment_terms"

    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # 0 = immediate

    __table_args__ = (
        CheckConstraint("days >= 0", name="ck_payment_term_days"),
    )


class Plan(Base, TimestampMixin):
    __tablename__ = "plans"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    billing_period: Mapped[str] = mapped_column(String(20), default="monthly", nullable=False)
    min_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    available_from: Mapped[date] = mapped_column(Date, nullable=False)
    available_to: Mapped[date] = mapped_column(Date, nullable=False)
    default_tax_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("taxes.id", ondelete="SET NULL"), nullable=True)
    auto_close_on_end: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_early_close: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_pause: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_renew: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint("billing_period IN ('daily', 'weekly', 'monthly', 'yearly')", name="ck_plan_billing_period"),
        CheckConstraint("price >= 0", name="ck_plan_price"),
        CheckConstraint("min_quantity >= 0", name="ck_plan_min_quantity"),
        CheckConstraint("available_from <= available_to", name="ck_plan_availability"),
    )

    default_tax: Mapped[Optional["Tax"]] = relationship("Tax")


class QuotationTemplate(Base, TimestampMixin):
    __tablename__ = "quotation_templates"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    plan_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("plans.id", ondelete="RESTRICT"), index=True, nullable=False)
    validity_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    payment_term_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("payment_terms.id", ondelete="RESTRICT"), index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint("validity_days >= 1", name="ck_quotation_template_validity"),
    )

    plan: Mapped["Plan"] = relationship("Plan")
    payment_term: Mapped["PaymentTerm"] = relationship("PaymentTerm")
    lines: Mapped[list["QuotationTemplateLine"]] = relationship("QuotationTemplateLine", back_populates="template", cascade="all, delete-orphan")


class QuotationTemplateLine(Base, TimestampMixin):
    __tablename__ = "quotation_template_lines"

    template_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("quotation_templates.id", ondelete="CASCADE"), index=True, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id", ondelete="RESTRICT"), index=True, nullable=False)
    variant_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        CheckConstraint("quantity >= 1", name="ck_template_line_qty"),
    )

    template: Mapped["QuotationTemplate"] = relationship("QuotationTemplate", back_populates="lines")
    product: Mapped["Product"] = relationship("Product")
    variant: Mapped[Optional["ProductVariant"]] = relationship("ProductVariant")
