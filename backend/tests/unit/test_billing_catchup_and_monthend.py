import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.config import settings
from app.db import SessionLocal
from app.models.billing import Invoice
from app.models.catalog import PaymentTerm, Plan
from app.models.identity import Customer
from app.models.subscription import Subscription
from app.seed import seed_database
from app.services.billing import run_billing_engine


def test_billing_catchup_cap_with_daily_plan():
    """Verify Requirement 9: Billing catch-up cap MAX_CATCHUP_PERIODS (default 12).

    A daily subscription started a year ago bills only the cap per run;
    remaining periods stay due and are reported in remaining_due.
    """
    today = date(2026, 7, 1)
    one_year_ago = today - timedelta(days=365)

    with SessionLocal() as db:
        customer = Customer(
            name=f"Catchup Corp {uuid.uuid4()}",
            email=f"catchup-{uuid.uuid4()}@brightloop.test",
        )
        term = db.query(PaymentTerm).first()
        plan = Plan(
            name=f"Daily Micro Service {uuid.uuid4()}",
            price=Decimal("10.00"),
            billing_period="daily",
            available_from=date(2020, 1, 1),
            available_to=date(2030, 1, 1),
        )
        db.add_all([customer, plan])
        db.flush()

        sub = Subscription(
            number=f"SUB-DAILY-{uuid.uuid4().hex[:6]}",
            customer_id=customer.id,
            plan_id=plan.id,
            payment_term_id=term.id if term else None,
            billing_anchor=one_year_ago,
            start_date=one_year_ago,
            expiry_date=date(2030, 1, 1),
            next_invoice_date=one_year_ago,
            periods_billed=0,
            status="active",
            currency="USD",
            version=1,
        )
        db.add(sub)
        db.commit()
        sub_id = sub.id

    # Execute billing engine as of today
    res = run_billing_engine(as_of_date=today, dry_run=False)

    # Must bill exactly MAX_CATCHUP_PERIODS (12) for this subscription
    with SessionLocal() as db:
        updated_sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
        assert updated_sub is not None
        assert updated_sub.periods_billed == settings.MAX_CATCHUP_PERIODS == 12
        assert updated_sub.next_invoice_date == one_year_ago + timedelta(days=12)
        assert updated_sub.next_invoice_date <= today

        invs = db.query(Invoice).filter(Invoice.subscription_id == sub_id).all()
        assert len(invs) == 12

    # remaining_due must be reported
    assert res.remaining_due >= (365 - 12)


def test_engine_level_month_end_anchor_jan31_feb_mar_no_drift():
    """Verify Requirement 10: Engine-level month-end test.

    Create a monthly subscription anchored on 31 Jan, run billing at 28 Feb and 31 Mar,
    and assert the stored period_start/period_end in DB (Feb 28 and Mar 31, no drift).
    """
    jan_31 = date(2026, 1, 31)
    feb_28 = date(2026, 2, 28)
    mar_31 = date(2026, 3, 31)

    with SessionLocal() as db:
        customer = Customer(
            name=f"MonthEnd Corp {uuid.uuid4()}",
            email=f"monthend-{uuid.uuid4()}@brightloop.test",
        )
        term = db.query(PaymentTerm).first()
        plan = Plan(
            name=f"Monthly SaaS {uuid.uuid4()}",
            price=Decimal("100.00"),
            billing_period="monthly",
            available_from=date(2020, 1, 1),
            available_to=date(2030, 1, 1),
        )
        db.add_all([customer, plan])
        db.flush()

        sub = Subscription(
            number=f"SUB-MTH-{uuid.uuid4().hex[:6]}",
            customer_id=customer.id,
            plan_id=plan.id,
            payment_term_id=term.id if term else None,
            billing_anchor=jan_31,
            start_date=jan_31,
            expiry_date=date(2030, 1, 1),
            next_invoice_date=jan_31,
            periods_billed=0,
            status="active",
            currency="USD",
            version=1,
        )
        db.add(sub)
        db.commit()
        sub_id = sub.id

    # 1. Run billing with clock at Feb 28
    res_feb = run_billing_engine(as_of_date=feb_28, dry_run=False)
    assert res_feb.created >= 2

    with SessionLocal() as db:
        invoices = (
            db.query(Invoice)
            .filter(Invoice.subscription_id == sub_id)
            .order_by(Invoice.period_start.asc())
            .all()
        )
        assert len(invoices) == 2

        # Cycle 1: 31 Jan to 27 Feb
        assert invoices[0].period_start == date(2026, 1, 31)
        assert invoices[0].period_end == date(2026, 2, 27)

        # Cycle 2: 28 Feb to 30 Mar (anchor + 1 month lands on 28 Feb!)
        assert invoices[1].period_start == date(2026, 2, 28)
        assert invoices[1].period_end == date(2026, 3, 30)

    # 2. Advance clock to Mar 31 and run billing again
    res_mar = run_billing_engine(as_of_date=mar_31, dry_run=False)
    assert res_mar.created >= 1

    with SessionLocal() as db:
        invoices = (
            db.query(Invoice)
            .filter(Invoice.subscription_id == sub_id)
            .order_by(Invoice.period_start.asc())
            .all()
        )
        assert len(invoices) == 3

        # Cycle 3: 31 Mar to 29 Apr (anchor 31 Jan + 2 months lands exactly on 31 Mar, NO DRIFT!)
        assert invoices[2].period_start == date(2026, 3, 31)
        assert invoices[2].period_end == date(2026, 4, 29)


def test_seeding_safety_production_refusal_and_reset_flag(monkeypatch):
    """Verify Requirement 11: Seeding safety refuses in production and requires explicit --reset when data exists."""
    # 1. Calling seed_database when data exists without reset returns False (refuses)
    refused = seed_database(small=True, reset=False)
    assert refused is False

    # 2. Refuses when ENVIRONMENT is production
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    with pytest.raises(RuntimeError, match="Refusing to seed: cannot run app.seed against a production environment"):
        seed_database(small=True, reset=True)
