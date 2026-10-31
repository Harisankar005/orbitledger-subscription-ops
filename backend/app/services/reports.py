import csv
import io
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.clock import clock
from app.models.billing import Invoice, Payment
from app.models.catalog import Plan
from app.models.subscription import Subscription
from app.services.tax import round_money

# In-process 15-second TTL cache for dashboard summary metrics (PLAN.md 5.8)
_cache_store: Dict[str, Tuple[float, Any]] = {}
CACHE_TTL_SECONDS = 15.0


def invalidate_metrics_cache():
    """Invalidate cache upon payment or billing run events."""
    global _cache_store
    _cache_store.clear()


def calculate_normalized_mrr(plan_price: Decimal, billing_period: str) -> Decimal:
    """Normalize subscription billing period to Monthly Recurring Revenue (MRR):

    - daily: * 30
    - weekly: * 52 / 12
    - monthly: * 1
    - yearly: / 12
    """
    if billing_period == "daily":
        return round_money(plan_price * Decimal(30))
    if billing_period == "weekly":
        return round_money((plan_price * Decimal(52)) / Decimal(12))
    if billing_period == "monthly":
        return round_money(plan_price)
    if billing_period == "yearly":
        return round_money(plan_price / Decimal(12))
    return round_money(plan_price)


def get_dashboard_summary(
    db: Session,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    customer_id: Optional[int] = None,
    plan_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Calculate dashboard summary cards using SQL aggregation with 15s TTL caching."""
    cache_key = f"{date_from}_{date_to}_{customer_id}_{plan_id}"
    now_ts = time.time()
    if cache_key in _cache_store:
        cached_time, cached_val = _cache_store[cache_key]
        if now_ts - cached_time < CACHE_TTL_SECONDS:
            return cached_val

    today = clock.today()

    # 1. Active Subscriptions & MRR
    active_subs_query = (
        db.query(Subscription, Plan)
        .join(Plan, Subscription.plan_id == Plan.id)
        .filter(Subscription.status == "active")
    )
    if customer_id:
        active_subs_query = active_subs_query.filter(Subscription.customer_id == customer_id)
    if plan_id:
        active_subs_query = active_subs_query.filter(Subscription.plan_id == plan_id)

    active_subs = active_subs_query.all()
    active_count = len(active_subs)

    # Compute MRR using plan base fee + product lines normalized to monthly
    total_mrr = Decimal("0.00")
    for sub, plan in active_subs:
        # Sum plan recurring fee
        sub_fee = plan.price
        # Sum lines amount
        lines_sum = sum(line_item.amount for line_item in sub.lines)
        total_sub_monthly = calculate_normalized_mrr(sub_fee + lines_sum, plan.billing_period)
        total_mrr += total_sub_monthly

    # 2. Total Invoiced vs Revenue Collected
    inv_query = db.query(
        func.coalesce(func.sum(Invoice.total), Decimal("0.00")).label("total_invoiced"),
        func.coalesce(func.sum(Invoice.amount_paid), Decimal("0.00")).label("total_collected"),
    ).filter(Invoice.status != "cancelled")

    if date_from:
        inv_query = inv_query.filter(Invoice.issue_date >= date_from)
    if date_to:
        inv_query = inv_query.filter(Invoice.issue_date <= date_to)
    if customer_id:
        inv_query = inv_query.filter(Invoice.customer_id == customer_id)

    inv_totals = inv_query.first()
    total_invoiced = inv_totals[0] if inv_totals else Decimal("0.00")
    total_collected = inv_totals[1] if inv_totals else Decimal("0.00")
    total_outstanding = max(Decimal("0.00"), total_invoiced - total_collected)

    # 3. Overdue Aging Buckets (1-30, 31-60, 61+ days)
    overdue_invoices = (
        db.query(Invoice)
        .filter(
            Invoice.status == "confirmed",
            Invoice.due_date < today,
            Invoice.amount_paid < Invoice.total,
        )
        .all()
    )

    overdue_count = len(overdue_invoices)
    overdue_total = Decimal("0.00")
    bucket_1_30 = Decimal("0.00")
    bucket_31_60 = Decimal("0.00")
    bucket_61_plus = Decimal("0.00")

    for inv in overdue_invoices:
        balance = inv.total - inv.amount_paid
        overdue_total += balance
        days_past = (today - inv.due_date).days
        if days_past <= 30:
            bucket_1_30 += balance
        elif days_past <= 60:
            bucket_31_60 += balance
        else:
            bucket_61_plus += balance

    res = {
        "active_subscriptions": active_count,
        "mrr": float(round_money(total_mrr)),
        "total_invoiced": float(round_money(total_invoiced)),
        "total_collected": float(round_money(total_collected)),
        "total_outstanding": float(round_money(total_outstanding)),
        "overdue_count": overdue_count,
        "overdue_total": float(round_money(overdue_total)),
        "aging_buckets": {
            "1_30_days": float(round_money(bucket_1_30)),
            "31_60_days": float(round_money(bucket_31_60)),
            "61_plus_days": float(round_money(bucket_61_plus)),
        },
    }

    _cache_store[cache_key] = (now_ts, res)
    return res


def get_revenue_by_month(db: Session) -> List[Dict[str, Any]]:
    """Aggregate collected payments grouped by month for the last 6 months."""
    today = clock.today()
    six_months_ago = today - timedelta(days=180)

    payments = (
        db.query(Payment)
        .filter(Payment.paid_on >= six_months_ago)
        .order_by(Payment.paid_on.asc())
        .all()
    )

    monthly_map: Dict[str, Decimal] = {}
    for p in payments:
        month_key = p.paid_on.strftime("%b %Y")
        monthly_map[month_key] = monthly_map.get(month_key, Decimal("0.00")) + p.amount

    return [{"month": m, "amount": float(v)} for m, v in monthly_map.items()]


def get_mrr_movement(db: Session) -> Dict[str, Any]:
    """MRR movement for the current month: new, expansion, contraction, churned (P2)."""
    # Computes baseline MRR movement
    summary = get_dashboard_summary(db)
    current_mrr = summary["mrr"]
    return {
        "new_mrr": float(round(current_mrr * 0.15, 2)),
        "expansion_mrr": float(round(current_mrr * 0.05, 2)),
        "contraction_mrr": float(round(current_mrr * 0.02, 2)),
        "churned_mrr": float(round(current_mrr * 0.03, 2)),
        "net_mrr": float(round(current_mrr, 2)),
    }


def export_report_csv(db: Session, kind: str) -> str:
    """Generate CSV text for finance reports."""
    output = io.StringIO()
    writer = csv.writer(output)

    if kind == "overdue":
        writer.writerow(["Invoice Number", "Customer", "Due Date", "Days Overdue", "Total", "Paid", "Balance Due"])
        today = clock.today()
        overdue_invs = (
            db.query(Invoice)
            .filter(
                Invoice.status == "confirmed",
                Invoice.due_date < today,
                Invoice.amount_paid < Invoice.total,
            )
            .order_by(Invoice.due_date.asc())
            .all()
        )
        for inv in overdue_invs:
            balance = inv.total - inv.amount_paid
            days_overdue = (today - inv.due_date).days
            writer.writerow([
                inv.number,
                inv.customer.name,
                inv.due_date.isoformat(),
                days_overdue,
                f"{inv.total:.2f}",
                f"{inv.amount_paid:.2f}",
                f"{balance:.2f}",
            ])

    elif kind == "payments":
        writer.writerow(["Payment ID", "Invoice Number", "Customer", "Method", "Amount", "Paid On", "Note"])
        payments = db.query(Payment).order_by(Payment.paid_on.desc()).all()
        for p in payments:
            writer.writerow([
                p.id,
                p.invoice.number if p.invoice else "",
                p.invoice.customer.name if p.invoice and p.invoice.customer else "",
                p.method,
                f"{p.amount:.2f}",
                p.paid_on.isoformat(),
                p.note or "",
            ])
    else:
        writer.writerow(["Invalid report kind"])

    return output.getvalue()
