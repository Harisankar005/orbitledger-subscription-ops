from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import TimestampMixin


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    actor_id: Mapped[Optional[int]] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    entity_id: Mapped[int] = mapped_column(BigInteger, index=True, nullable=False)
    before_state: Mapped[Optional[dict[str, Any]]] = mapped_column("before", JSON, nullable=True)
    after_state: Mapped[Optional[dict[str, Any]]] = mapped_column("after", JSON, nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True, nullable=False)

    actor: Mapped[Optional["User"]] = relationship("User")  # noqa: F821


class OutboxMessage(Base, TimestampMixin):
    __tablename__ = "outbox_messages"

    to_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body_html: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)  # 'invoice_sent', 'dunning_reminder', 'password_reset'
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True, nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="ck_outbox_status"),
        CheckConstraint("attempts >= 0", name="ck_outbox_attempts"),
    )


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
