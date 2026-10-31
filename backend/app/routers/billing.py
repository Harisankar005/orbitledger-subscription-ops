from fastapi import APIRouter, Depends, Header, Request

from app.deps import require_roles
from app.models.identity import User
from app.schemas.billing import BillingRunRequest, BillingRunResponse
from app.services import billing as billing_service
from app.services.idempotency import execute_with_idempotency

router = APIRouter(prefix="/billing", tags=["billing"])


@router.post("/run", response_model=BillingRunResponse)
def trigger_billing_run(
    req: BillingRunRequest,
    request: Request,
    current_user: User = Depends(require_roles("admin", "staff")),
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
):
    """Trigger recurring billing run with strict, transaction-safe idempotency guarantees."""
    req_id = getattr(request.state, "request_id", None)

    def do_billing():
        return billing_service.run_billing_engine(
            as_of_date=req.as_of_date,
            dry_run=req.dry_run,
            actor_id=current_user.id,
            request_id=req_id,
        )

    res, _ = execute_with_idempotency(
        key=idempotency_key,
        endpoint="/api/billing/run",
        payload=req,
        operation_fn=do_billing,
    )

    if isinstance(res, BillingRunResponse):
        return res
    return BillingRunResponse(**res)
