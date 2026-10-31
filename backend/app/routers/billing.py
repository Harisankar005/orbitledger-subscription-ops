import hashlib
import json
from typing import Optional

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.models.identity import User
from app.models.platform import IdempotencyKey
from app.schemas.billing import BillingRunRequest, BillingRunResponse
from app.services import billing as billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


@router.post("/run", response_model=BillingRunResponse)
def trigger_billing_run(
    req: BillingRunRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    req_id = getattr(request.state, "request_id", None)

    # Idempotency check for POST /billing/run
    if idempotency_key:
        clean_key = idempotency_key.strip()
        existing = db.query(IdempotencyKey).filter(IdempotencyKey.key == clean_key).first()
        if existing:
            cached_data = json.loads(existing.response_json)
            return BillingRunResponse(**cached_data)

    res = billing_service.run_billing_engine(
        as_of_date=req.as_of_date,
        dry_run=req.dry_run,
        actor_id=current_user.id,
        request_id=req_id,
    )

    if idempotency_key and not req.dry_run:
        clean_key = idempotency_key.strip()
        payload_str = json.dumps(req.model_dump(), default=str)
        req_hash = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
        stored_entry = IdempotencyKey(
            key=clean_key,
            endpoint="/api/billing/run",
            request_hash=req_hash,
            response_json=res.model_dump_json(),
        )
        db.add(stored_entry)
        db.commit()

    return res
