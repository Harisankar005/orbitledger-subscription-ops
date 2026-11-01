from datetime import date
from typing import List, Optional

from pydantic import BaseModel


class BillingRunRequest(BaseModel):
    as_of_date: Optional[date] = None
    dry_run: bool = False


class BillingRunFailedItem(BaseModel):
    subscription_id: int
    subscription_number: str
    reason: str


class BillingRunResponse(BaseModel):
    created: int
    skipped_already_billed: int
    skipped_not_due: int
    remaining_due: int = 0
    failed: List[BillingRunFailedItem] = []
    duration_ms: int
    dry_run: bool
    as_of_date: date
