"""Comprehensive tests for services/subscription.py covering plan flags and lifecycle logic:

allow_pause, allow_early_close, allow_renew, auto_close_on_end, min_quantity, availability dates, and renew.
"""

import uuid
from datetime import timedelta
from decimal import Decimal

import pytest

from app.clock import clock
from app.db import SessionLocal
from app.errors import ConflictError, IllegalTransitionError, NotFoundError, ValidationError
from app.models.catalog import PaymentTerm, Plan, Product, QuotationTemplate, QuotationTemplateLine
from app.models.identity import Customer
from app.models.subscription import Subscription
from app.schemas.subscription import SubscriptionCreate, SubscriptionLineCreate, SubscriptionUpdate
from app.services.subscription import (
    create_from_template,
    create_subscription,
    renew_subscription,
    transition_subscription,
    update_subscription,
)
from app.worker import job_auto_close_expired_subscriptions


@pytest.fixture
def test_setup():
    with SessionLocal() as db:
        suffix = uuid.uuid4().hex[:6]
        cust = Customer(
            name=f"Sub Plan Test Corp {suffix}",
            email=f"sub-test-{suffix}@corp.test",
            billing_address="456 Innovation Way",
        )
        db.add(cust)

        prod = Product(
            name=f"Pro License {suffix}",
            type="software",
            sales_price=Decimal("100.00"),
            is_active=True,
        )
        db.add(prod)
        db.flush()

        today = clock.today()

        # 1. Standard plan
        std_plan = Plan(
            name=f"Standard Flexible Plan {suffix}",
            price=Decimal("100.00"),
            billing_period="monthly",
            min_quantity=1,
            available_from=today - timedelta(days=30),
            available_to=today + timedelta(days=365),
            allow_pause=True,
            allow_early_close=True,
            allow_renew=True,
            auto_close_on_end=True,
        )
        # 2. Strict plan with pause/early-close/renew forbidden and high min_quantity
        strict_plan = Plan(
            name=f"Strict Fixed Plan {suffix}",
            price=Decimal("500.00"),
            billing_period="monthly",
            min_quantity=10,
            available_from=today + timedelta(days=10),
            available_to=today + timedelta(days=90),
            allow_pause=False,
            allow_early_close=False,
            allow_renew=False,
            auto_close_on_end=False,
        )
        db.add_all([std_plan, strict_plan])
        db.flush()

        term = db.query(PaymentTerm).first()
        term_id = term.id if term else 1

        db.commit()

        return {
            "customer_id": cust.id,
            "product_id": prod.id,
            "std_plan_id": std_plan.id,
            "strict_plan_id": strict_plan.id,
            "payment_term_id": term_id,
            "today": today,
        }


def test_plan_flag_allow_pause(test_setup):
    """Verify that allow_pause=False blocks pausing, while allow_pause=True permits it."""
    with SessionLocal() as db:
        today = test_setup["today"]

        # 1. Test plan with allow_pause = False
        # Create a plan starting today
        plan = db.query(Plan).filter(Plan.id == test_setup["strict_plan_id"]).first()
        plan.available_from = today - timedelta(days=5)
        plan.min_quantity = 1
        db.commit()

        sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=plan.id,
                start_date=today,
                expiry_date=today + timedelta(days=90),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )
        sub = transition_subscription(db, sub.id, "quotation")
        sub = transition_subscription(db, sub.id, "confirmed")
        sub = transition_subscription(db, sub.id, "active")
        assert sub.status == "active"

        # Attempt to pause should fail with PAUSE_NOT_ALLOWED
        with pytest.raises(ConflictError, match="does not allow pausing subscriptions"):
            transition_subscription(db, sub.id, "paused")

        # 2. Test plan with allow_pause = True
        std_sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=test_setup["std_plan_id"],
                start_date=today,
                expiry_date=today + timedelta(days=90),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )
        std_sub = transition_subscription(db, std_sub.id, "quotation")
        std_sub = transition_subscription(db, std_sub.id, "confirmed")
        std_sub = transition_subscription(db, std_sub.id, "active")
        assert std_sub.status == "active"

        paused_sub = transition_subscription(db, std_sub.id, "paused")
        assert paused_sub.status == "paused"

        resumed_sub = transition_subscription(db, paused_sub.id, "active")
        assert resumed_sub.status == "active"


def test_plan_flag_allow_early_close(test_setup):
    """Verify that allow_early_close=False prevents closing before expiry date."""
    with SessionLocal() as db:
        today = test_setup["today"]

        strict_plan = db.query(Plan).filter(Plan.id == test_setup["strict_plan_id"]).first()
        strict_plan.available_from = today - timedelta(days=5)
        strict_plan.min_quantity = 1
        db.commit()

        sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=strict_plan.id,
                start_date=today,
                expiry_date=today + timedelta(days=90),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )
        sub = transition_subscription(db, sub.id, "quotation")
        sub = transition_subscription(db, sub.id, "confirmed")
        sub = transition_subscription(db, sub.id, "active")

        # Attempting early close when today < expiry_date fails
        with pytest.raises(ConflictError, match="does not permit early termination"):
            transition_subscription(db, sub.id, "closed")

        # Flexible plan allows early close
        std_sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=test_setup["std_plan_id"],
                start_date=today,
                expiry_date=today + timedelta(days=90),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )
        std_sub = transition_subscription(db, std_sub.id, "quotation")
        std_sub = transition_subscription(db, std_sub.id, "confirmed")
        std_sub = transition_subscription(db, std_sub.id, "active")

        closed_std = transition_subscription(db, std_sub.id, "closed")
        assert closed_std.status == "closed"


def test_plan_flag_allow_renew(test_setup):
    """Verify that allow_renew=False blocks renewals, and allow_renew=True renews accurately."""
    with SessionLocal() as db:
        today = test_setup["today"]

        # 1. Non-renewable plan
        strict_plan = db.query(Plan).filter(Plan.id == test_setup["strict_plan_id"]).first()
        strict_plan.available_from = today - timedelta(days=5)
        strict_plan.min_quantity = 1
        db.commit()

        sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=strict_plan.id,
                start_date=today,
                expiry_date=today + timedelta(days=30),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )
        with pytest.raises(ConflictError, match="does not permit renewals"):
            renew_subscription(db, sub.id)

        # 2. Renewable plan
        std_sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=test_setup["std_plan_id"],
                start_date=today,
                expiry_date=today + timedelta(days=30),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=2)],
            ),
        )
        std_sub = transition_subscription(db, std_sub.id, "quotation")
        std_sub = transition_subscription(db, std_sub.id, "confirmed")
        std_sub = transition_subscription(db, std_sub.id, "active")

        renewed = renew_subscription(db, std_sub.id, actor_id=1)
        assert renewed.id != std_sub.id
        assert renewed.start_date == std_sub.expiry_date + timedelta(days=1)
        assert renewed.expiry_date == renewed.start_date + timedelta(days=30)
        assert len(renewed.lines) == 1
        assert renewed.lines[0].quantity == 2

        # Verify old subscription was closed
        db.refresh(std_sub)
        assert std_sub.status == "closed"


def test_plan_flag_min_quantity(test_setup):
    """Verify minimum quantity enforcement when transitioning draft to quotation."""
    with SessionLocal() as db:
        today = test_setup["today"]

        # Strict plan has min_quantity=10
        strict_plan = db.query(Plan).filter(Plan.id == test_setup["strict_plan_id"]).first()
        strict_plan.available_from = today - timedelta(days=5)
        strict_plan.min_quantity = 10
        db.commit()

        # Subscription with total quantity 4 < 10
        sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=strict_plan.id,
                start_date=today,
                expiry_date=today + timedelta(days=60),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=4)],
            ),
        )

        with pytest.raises(ValidationError, match="does not meet the plan minimum required"):
            transition_subscription(db, sub.id, "quotation")

        # Update draft subscription with sufficient quantity
        sub = update_subscription(
            db,
            sub.id,
            SubscriptionUpdate(
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=12)],
            ),
        )
        quotation_sub = transition_subscription(db, sub.id, "quotation")
        assert quotation_sub.status == "quotation"


def test_plan_flag_availability_dates(test_setup):
    """Verify that subscription start_date outside plan availability window is rejected."""
    with SessionLocal() as db:
        today = test_setup["today"]

        # Strict plan is available from today+10 to today+90
        strict_plan = db.query(Plan).filter(Plan.id == test_setup["strict_plan_id"]).first()
        strict_plan.available_from = today + timedelta(days=10)
        strict_plan.available_to = today + timedelta(days=90)
        strict_plan.min_quantity = 1
        db.commit()

        # Start date today is before available_from (today+10)
        sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=strict_plan.id,
                start_date=today,
                expiry_date=today + timedelta(days=60),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )

        with pytest.raises(ConflictError, match="is outside this range"):
            transition_subscription(db, sub.id, "quotation")

        # Update start date to within availability window
        sub = update_subscription(
            db,
            sub.id,
            SubscriptionUpdate(
                start_date=today + timedelta(days=15),
                expiry_date=today + timedelta(days=75),
            ),
        )
        q_sub = transition_subscription(db, sub.id, "quotation")
        assert q_sub.status == "quotation"


def test_plan_flag_auto_close_on_end(test_setup):
    """Verify that worker auto-close job closes expired subscriptions only if plan.auto_close_on_end is True."""
    with SessionLocal() as db:
        today = clock.today()

        # 1. Expired subscription on plan with auto_close_on_end = True
        plan_autoclose = db.query(Plan).filter(Plan.id == test_setup["std_plan_id"]).first()
        plan_autoclose.auto_close_on_end = True
        plan_autoclose.allow_early_close = True

        # 2. Expired subscription on plan with auto_close_on_end = False
        plan_no_autoclose = db.query(Plan).filter(Plan.id == test_setup["strict_plan_id"]).first()
        plan_no_autoclose.auto_close_on_end = False
        plan_no_autoclose.available_from = today - timedelta(days=100)
        plan_no_autoclose.available_to = today + timedelta(days=100)
        plan_no_autoclose.min_quantity = 1
        db.commit()

        # Create active sub that expired 5 days ago (auto_close = True)
        sub_auto = Subscription(
            number=f"SUB-AUTO-{uuid.uuid4().hex[:6]}",
            customer_id=test_setup["customer_id"],
            plan_id=plan_autoclose.id,
            status="active",
            start_date=today - timedelta(days=60),
            expiry_date=today - timedelta(days=5),
            payment_term_id=test_setup["payment_term_id"],
            billing_anchor=today - timedelta(days=60),
            next_invoice_date=today - timedelta(days=60),
            periods_billed=1,
            currency="INR",
            version=1,
        )
        # Create active sub that expired 5 days ago (auto_close = False)
        sub_no_auto = Subscription(
            number=f"SUB-NOAUTO-{uuid.uuid4().hex[:6]}",
            customer_id=test_setup["customer_id"],
            plan_id=plan_no_autoclose.id,
            status="active",
            start_date=today - timedelta(days=60),
            expiry_date=today - timedelta(days=5),
            payment_term_id=test_setup["payment_term_id"],
            billing_anchor=today - timedelta(days=60),
            next_invoice_date=today - timedelta(days=60),
            periods_billed=1,
            currency="INR",
            version=1,
        )
        db.add_all([sub_auto, sub_no_auto])
        db.commit()

        # Run worker job
        job_auto_close_expired_subscriptions()

        db.refresh(sub_auto)
        db.refresh(sub_no_auto)

        assert sub_auto.status == "closed", "Subscription with auto_close_on_end=True must be closed"
        assert sub_no_auto.status == "active", "Subscription with auto_close_on_end=False must stay active"


def test_subscription_optimistic_locking_and_validation(test_setup):
    """Test optimistic concurrency version checking and validation."""
    with SessionLocal() as db:
        today = test_setup["today"]

        # Date validation error: start_date > expiry_date
        with pytest.raises(ValidationError, match="start_date cannot be after expiry_date"):
            create_subscription(
                db,
                SubscriptionCreate(
                    customer_id=test_setup["customer_id"],
                    plan_id=test_setup["std_plan_id"],
                    start_date=today + timedelta(days=10),
                    expiry_date=today,
                    lines=[],
                ),
            )

        sub = create_subscription(
            db,
            SubscriptionCreate(
                customer_id=test_setup["customer_id"],
                plan_id=test_setup["std_plan_id"],
                start_date=today,
                expiry_date=today + timedelta(days=30),
                payment_term_id=test_setup["payment_term_id"],
                lines=[SubscriptionLineCreate(product_id=test_setup["product_id"], quantity=1)],
            ),
        )

        # Version mismatch concurrency conflict
        with pytest.raises(ConflictError, match="modified by another operation"):
            transition_subscription(db, sub.id, "quotation", expected_version=99)

        # Transition with matching expected_version succeeds
        q_sub = transition_subscription(db, sub.id, "quotation", expected_version=sub.version)
        assert q_sub.status == "quotation"

        # Attempting to update non-draft raises ConflictError
        with pytest.raises(ConflictError, match="Only draft subscriptions can be modified"):
            update_subscription(db, sub.id, SubscriptionUpdate(notes="Should fail"))


def test_create_from_template_and_illegal_transitions(test_setup):
    """Test create_from_template, illegal transition, and NotFoundError."""
    with SessionLocal() as db:
        today = test_setup["today"]
        prod = db.query(Product).first()
        plan = db.query(Plan).first()
        term = db.query(PaymentTerm).first()

        tpl = QuotationTemplate(
            name=f"Template {uuid.uuid4().hex[:6]}",
            plan_id=plan.id,
            validity_days=30,
            payment_term_id=term.id,
            is_active=True,
            lines=[QuotationTemplateLine(product_id=prod.id, quantity=2)],
        )
        db.add(tpl)
        db.commit()

        sub = create_from_template(
            db,
            template_id=tpl.id,
            customer_id=test_setup["customer_id"],
            start_date=today,
            expiry_date=today + timedelta(days=60),
            notes="From template",
            actor_id=1,
        )
        assert sub.id is not None
        assert sub.status == "draft"
        assert len(sub.lines) == 1

        # Illegal transition: draft directly to active
        with pytest.raises(IllegalTransitionError, match="Cannot transition subscription"):
            transition_subscription(db, sub.id, "active")

        # Not found subscription
        with pytest.raises(NotFoundError, match="Subscription not found"):
            transition_subscription(db, 999999, "quotation")
