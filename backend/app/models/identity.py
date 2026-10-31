from datetime import datetime
from typing import Optional
from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base
from app.models.base import TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="customer", nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'staff', 'customer')", name="ck_user_role"),
    )

    # Relationships
    customer: Mapped[Optional["Customer"]] = relationship("Customer", back_populates="user", uselist=False)
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")
    password_reset_tokens: Mapped[list["PasswordResetToken"]] = relationship("PasswordResetToken", back_populates="user", cascade="all, delete-orphan")


class RefreshToken(Base, TimestampMixin):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    family_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")


class PasswordResetToken(Base, TimestampMixin):
    __tablename__ = "password_reset_tokens"

    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="password_reset_tokens")


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"

    user_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), unique=True, index=True, nullable=True)
    name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    company: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    billing_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tax_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    __table_args__ = (
        Index("ix_customers_lower_name", "name"),
    )

    user: Mapped[Optional["User"]] = relationship("User", back_populates="customer")
