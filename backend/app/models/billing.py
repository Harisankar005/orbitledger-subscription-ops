from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base
from app.models.base import TimestampMixin, VersionMixin


class DiscountRule(Base, TimestampMixin):
    __tablename__ = "discount_rules"

    name: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="percent", nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    min_purchase_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    min_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    usage_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    scope: Mapped[str] = mapped_column(String(20), default="subscription", nullable=False)
    product_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    target_subscription_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint("kind IN ('fixed', 'percent')", name="ck_discount_kind"),
        CheckConstraint("scope IN ('product', 'subscription')", name="ck_discount_scope"),
        CheckConstraint("value >= 0", name="ck_discount_value"),
        CheckConstraint("min_purchase_amount >= 0", name="ck_discount_min_amount"),
        CheckConstraint("min_quantity >= 0", name="ck_discount_min_qty"),
        CheckConstraint("used_count >= 0", name="ck_discount_used_count"),
        CheckConstraint("start_date <= end_date", name="ck_discount_dates"),
    )

    product: Mapped[Optional["Product"]] = relationship("Product")  # noqa: F821
    target_subscription: Mapped[Optional["Subscription"]] = relationship("Subscription")  # noqa: F821


class Invoice(Base, TimestampMixin, VersionMixin):
    __tablename__ = "invoices"

    number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    subscription_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("subscriptions.id", ondelete="RESTRICT"), index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("customers.id", ondelete="RESTRICT"), index=True, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="draft", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("subscription_id", "period_start", name="uq_invoice_sub_period_start"),
        CheckConstraint("status IN ('draft', 'confirmed', 'paid', 'cancelled')", name="ck_invoice_status"),
        CheckConstraint("period_start <= period_end", name="ck_invoice_period"),
        CheckConstraint("subtotal >= 0", name="ck_invoice_subtotal"),
        CheckConstraint("discount_total >= 0", name="ck_invoice_discount_total"),
        CheckConstraint("tax_total >= 0", name="ck_invoice_tax_total"),
        CheckConstraint("total >= 0", name="ck_invoice_total"),
        CheckConstraint("amount_paid >= 0", name="ck_invoice_amount_paid"),
        Index("ix_invoices_status_due_date", "status", "due_date"),
        Index("ix_invoices_customer_created", "customer_id", "created_at"),
    )

    subscription: Mapped["Subscription"] = relationship("Subscription")  # noqa: F821
    customer: Mapped["Customer"] = relationship("Customer")  # noqa: F821
    lines: Mapped[list["InvoiceLine"]] = relationship("InvoiceLine", back_populates="invoice", cascade="all, delete-orphan")
    applied_discounts: Mapped[list["AppliedDiscount"]] = relationship("AppliedDiscount", back_populates="invoice", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship("Payment", back_populates="invoice", cascade="all, delete-orphan", order_by="Payment.paid_on.desc()")


class InvoiceLine(Base, TimestampMixin):
    __tablename__ = "invoice_lines"

    invoice_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("invoices.id", ondelete="CASCADE"), index=True, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)  # 'plan_fee' or 'product'
    product_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    tax_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("taxes.id", ondelete="SET NULL"), nullable=True)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), default=Decimal("0.00"), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("source IN ('plan_fee', 'product')", name="ck_invoice_line_source"),
        CheckConstraint("quantity >= 1", name="ck_invoice_line_qty"),
        CheckConstraint("unit_price >= 0", name="ck_invoice_line_unit_price"),
        CheckConstraint("discount_amount >= 0", name="ck_invoice_line_discount"),
        CheckConstraint("tax_amount >= 0", name="ck_invoice_line_tax"),
        CheckConstraint("line_total >= 0", name="ck_invoice_line_total"),
    )

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="lines")
    product: Mapped[Optional["Product"]] = relationship("Product")  # noqa: F821
    tax: Mapped[Optional["Tax"]] = relationship("Tax")  # noqa: F821


class AppliedDiscount(Base, TimestampMixin):
    __tablename__ = "applied_discounts"

    invoice_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("invoices.id", ondelete="CASCADE"), index=True, nullable=False)
    invoice_line_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("invoice_lines.id", ondelete="CASCADE"), nullable=True)
    discount_rule_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("discount_rules.id", ondelete="RESTRICT"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_applied_discount_amount"),
    )

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="applied_discounts")
    invoice_line: Mapped[Optional["InvoiceLine"]] = relationship("InvoiceLine")
    discount_rule: Mapped["DiscountRule"] = relationship("DiscountRule")


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"

    invoice_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("invoices.id", ondelete="RESTRICT"), index=True, nullable=False)
    method: Mapped[str] = mapped_column(String(50), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    paid_on: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True, nullable=True)

    __table_args__ = (
        CheckConstraint("method IN ('cash', 'card', 'upi', 'bank_transfer', 'cheque')", name="ck_payment_method"),
        CheckConstraint("amount > 0", name="ck_payment_amount_positive"),
    )

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="payments")
    recorder: Mapped[Optional["User"]] = relationship("User")  # noqa: F821


class NumberCounter(Base):
    __tablename__ = "number_counters"

    name: Mapped[str] = mapped_column(String(20), primary_key=True)
    next_value: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)
