from datetime import date, datetime, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from app.models.catalog import (
        PaymentTerm,
        Plan,
        Product,
        ProductVariant,
        QuotationTemplate,
        Tax,
    )
    from app.models.identity import Customer, User

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin, VersionMixin


class Subscription(Base, TimestampMixin, VersionMixin):
    __tablename__ = "subscriptions"

    number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    customer_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("customers.id", ondelete="RESTRICT"), index=True, nullable=False)
    plan_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("plans.id", ondelete="RESTRICT"), index=True, nullable=False)
    template_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("quotation_templates.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="draft", nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_term_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("payment_terms.id", ondelete="RESTRICT"), nullable=False)
    quotation_valid_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    billing_anchor: Mapped[date] = mapped_column(Date, nullable=False)
    periods_billed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('draft', 'quotation', 'confirmed', 'active', 'paused', 'closed')", name="ck_subscription_status"),
        CheckConstraint("start_date <= expiry_date", name="ck_sub_dates"),
        CheckConstraint("periods_billed >= 0", name="ck_sub_periods_billed"),
        Index("ix_subscriptions_status_next_invoice", "status", "next_invoice_date"),
        Index("ix_subscriptions_customer_status", "customer_id", "status"),
    )

    # Relationships
    customer: Mapped["Customer"] = relationship("Customer")  # noqa: F821
    plan: Mapped["Plan"] = relationship("Plan")  # noqa: F821
    template: Mapped[Optional["QuotationTemplate"]] = relationship("QuotationTemplate")  # noqa: F821
    payment_term: Mapped["PaymentTerm"] = relationship("PaymentTerm")  # noqa: F821
    lines: Mapped[list["SubscriptionLine"]] = relationship("SubscriptionLine", back_populates="subscription", cascade="all, delete-orphan")
    status_history: Mapped[list["SubscriptionStatusHistory"]] = relationship("SubscriptionStatusHistory", back_populates="subscription", cascade="all, delete-orphan", order_by="SubscriptionStatusHistory.changed_at.desc()")


class SubscriptionLine(Base, TimestampMixin):
    __tablename__ = "subscription_lines"

    subscription_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True, nullable=False)
    product_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("products.id", ondelete="RESTRICT"), index=True, nullable=False)
    variant_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("product_variants.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)  # Snapshot at time of addition
    tax_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("taxes.id", ondelete="SET NULL"), nullable=True)  # Resolved snapshot
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("quantity >= 1", name="ck_sub_line_qty"),
        CheckConstraint("unit_price >= 0", name="ck_sub_line_unit_price"),
        CheckConstraint("amount >= 0", name="ck_sub_line_amount"),
    )

    subscription: Mapped["Subscription"] = relationship("Subscription", back_populates="lines")
    product: Mapped["Product"] = relationship("Product")  # noqa: F821
    variant: Mapped[Optional["ProductVariant"]] = relationship("ProductVariant")  # noqa: F821
    tax: Mapped[Optional["Tax"]] = relationship("Tax")  # noqa: F821


class SubscriptionStatusHistory(Base, TimestampMixin):
    __tablename__ = "subscription_status_history"

    subscription_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("subscriptions.id", ondelete="CASCADE"), index=True, nullable=False)
    from_status: Mapped[str] = mapped_column(String(50), nullable=False)
    to_status: Mapped[str] = mapped_column(String(50), nullable=False)
    changed_by: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    subscription: Mapped["Subscription"] = relationship("Subscription", back_populates="status_history")
    actor: Mapped[Optional["User"]] = relationship("User")  # noqa: F821
