from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

__all__ = ["Base", "TimestampMixin", "VersionMixin"]


class TimestampMixin:
    """Standard audit timestamps for all persistent models."""
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class VersionMixin:
    """Optimistic concurrency lock version counter."""
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
