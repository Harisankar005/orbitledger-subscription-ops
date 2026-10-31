from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import PlainTextResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.models.billing import Payment
from app.models.identity import User
from app.models.subscription import Subscription
from app.services import reports as reports_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/dashboard", response_model=Dict[str, Any])
@router.get("/summary", response_model=Dict[str, Any])
def get_summary(
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    customer_id: Optional[int] = Query(None),
    plan_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    return reports_service.get_dashboard_summary(db, date_from, date_to, customer_id, plan_id)


@router.get("/revenue-by-month", response_model=List[Dict[str, Any]])
def get_revenue_by_month(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    return reports_service.get_revenue_by_month(db)


@router.get("/status-breakdown", response_model=Dict[str, int])
def get_status_breakdown(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    counts = db.query(Subscription.status, func.count(Subscription.id)).group_by(Subscription.status).all()
    return {status: count for status, count in counts}


@router.get("/payment-methods", response_model=Dict[str, float])
def get_payment_methods(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    totals = db.query(Payment.method, func.sum(Payment.amount)).group_by(Payment.method).all()
    return {method: float(amt or 0) for method, amt in totals}


@router.get("/mrr-movement", response_model=Dict[str, Any])
def get_mrr_movement(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    return reports_service.get_mrr_movement(db)


@router.get("/export/{kind}.csv", response_class=PlainTextResponse)
def export_csv(
    kind: str,
    response: Response,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    csv_data = reports_service.export_report_csv(db, kind)
    response.headers["Content-Disposition"] = f"attachment; filename=brightloop_{kind}_{date.today().isoformat()}.csv"
    response.headers["Content-Type"] = "text/csv"
    return csv_data
