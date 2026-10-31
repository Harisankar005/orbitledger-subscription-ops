from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.platform import AuditLog


def log_audit(
    db: Session,
    actor_id: Optional[int],
    action: str,
    entity_type: str,
    entity_id: int,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    request_id: Optional[str] = None,
) -> AuditLog:
    """Record an immutable, append-only audit trail entry in the current transaction."""
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_state=before,
        after_state=after,
        request_id=request_id,
        at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()
    return entry
