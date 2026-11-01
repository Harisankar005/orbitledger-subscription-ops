from typing import Any, Dict, Optional

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.clock import clock
from app.config import settings
from app.db import get_db
from app.deps import require_roles
from app.errors import ForbiddenError, NotFoundError
from app.events import broadcaster
from app.models.identity import User
from app.models.platform import AuditLog, OutboxMessage
from app.services.audit import log_audit
from app.services.billing import run_billing_engine

router = APIRouter(tags=["platform"])


@router.get("/health")
def health():
    return {"status": "ok", "time": clock.now().isoformat()}


@router.get("/ready")
def readiness_check(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ready", "database": "connected", "simulated_date": clock.today().isoformat()}


@router.get("/events")
async def sse_events(request: Request):
    """Server-Sent Events endpoint for real-time frontend updates (PLAN.md 5.9)."""
    return StreamingResponse(
        broadcaster.subscribe(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/audit-log", response_model=Dict[str, Any])
def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    entity_type: Optional[str] = Query(None),
    actor_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    query = db.query(AuditLog)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if actor_id:
        query = query.filter(AuditLog.actor_id == actor_id)

    total = query.count()
    items = query.order_by(AuditLog.at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [
            {
                "id": a.id,
                "actor_id": a.actor_id,
                "action": a.action,
                "entity_type": a.entity_type,
                "entity_id": a.entity_id,
                "before": a.before_state,
                "after": a.after_state,
                "request_id": a.request_id,
                "at": a.at,
            }
            for a in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/outbox", response_model=Dict[str, Any])
def list_outbox_messages(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    query = db.query(OutboxMessage)
    if status:
        query = query.filter(OutboxMessage.status == status)

    total = query.count()
    items = query.order_by(OutboxMessage.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [
            {
                "id": m.id,
                "to_email": m.to_email,
                "subject": m.subject,
                "kind": m.kind,
                "status": m.status,
                "attempts": m.attempts,
                "last_error": m.last_error,
                "created_at": m.created_at,
                "sent_at": m.sent_at,
            }
            for m in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/outbox/{id}/retry", response_model=Dict[str, Any])
def retry_outbox_message(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    """Admin-only: Reset outbox message status to pending so it can be retried."""
    req_id = getattr(request.state, "request_id", None)
    msg = db.query(OutboxMessage).filter(OutboxMessage.id == id).first()
    if not msg:
        raise NotFoundError("Outbox message not found")

    before_status = msg.status
    msg.status = "pending"
    msg.last_error = None
    db.commit()
    db.refresh(msg)

    log_audit(
        db=db,
        actor_id=current_user.id,
        action="outbox.retried",
        entity_type="outbox_message",
        entity_id=msg.id,
        before={"status": before_status},
        after={"status": msg.status},
        request_id=req_id,
    )

    return {
        "id": msg.id,
        "to_email": msg.to_email,
        "subject": msg.subject,
        "kind": msg.kind,
        "status": msg.status,
        "attempts": msg.attempts,
        "last_error": msg.last_error,
        "created_at": msg.created_at,
        "sent_at": msg.sent_at,
    }


class AdvanceClockRequest(BaseModel):
    months: int = 1


@router.post("/demo/advance-clock")
def demo_time_travel(
    req: AdvanceClockRequest,
    current_user: User = Depends(require_roles("admin")),
):
    """Time-travel demo mode: Advance simulated clock and trigger billing (PLAN.md 5.10 P2)."""
    if not settings.DEMO_MODE:
        raise ForbiddenError("Demo mode is disabled in production")

    old_date = clock.today()
    new_date = clock.advance_months(req.months)
    billing_result = run_billing_engine(as_of_date=new_date, dry_run=False, actor_id=current_user.id)

    return {
        "old_date": old_date.isoformat(),
        "new_date": new_date.isoformat(),
        "months_advanced": req.months,
        "billing_result": billing_result.model_dump(),
    }


@router.post("/demo/reset-clock")
def demo_reset_clock(
    current_user: User = Depends(require_roles("admin")),
):
    """Admin-only: Reset simulated clock offset to real-world clock."""
    if not settings.DEMO_MODE:
        raise ForbiddenError("Demo mode is disabled in production")
    real_today = clock.reset()
    return {"current_date": real_today.isoformat(), "is_simulated": False}


@router.get("/demo/clock-status")
def demo_clock_status(
    current_user: User = Depends(require_roles("admin", "staff")),
):
    """Get current simulated or real date and whether clock is offset."""
    is_simulated = clock.offset_delta != relativedelta()
    return {
        "current_date": clock.today().isoformat(),
        "is_simulated": is_simulated,
        "demo_mode": settings.DEMO_MODE,
    }
