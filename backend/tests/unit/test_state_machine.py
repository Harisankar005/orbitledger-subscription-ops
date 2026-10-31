from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.errors import ConflictError, IllegalTransitionError, ValidationError
from app.models.base import Base
from app.models.catalog import Plan, Product
from app.models.identity import Customer
from app.models.subscription import Subscription, SubscriptionLine
from app.services.subscription import transition_subscription

engine = create_engine("sqlite:///:memory:")
Base.metadata.create_all(bind=engine)
TestSession = sessionmaker(bind=engine)


@pytest.fixture
def setup_subscription_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with TestSession() as db:
        cust = Customer(name="Test Customer", email="test@cust.com")
        db.add(cust)
        plan = Plan(
            name="SaaS Pro Plan",
            price=Decimal("100.00"),
            billing_period="monthly",
            min_quantity=2,
            available_from=date.today() - timedelta(days=10),
            available_to=date.today() + timedelta(days=10),
            allow_pause=False,       # Pause forbidden
            allow_early_close=False, # Early close forbidden
            allow_renew=True,
        )
        db.add(plan)
        prod = Product(name="Seat", type="software", sales_price=Decimal("50.00"), is_active=True)
        db.add(prod)
        db.flush()

        sub = Subscription(
            number="SUB-999999",
            customer_id=cust.id,
            plan_id=plan.id,
            status="quotation",
            start_date=date.today(),
            expiry_date=date.today() + timedelta(days=365),
            payment_term_id=1,
            quotation_valid_until=date.today() + timedelta(days=30),
            billing_anchor=date.today(),
            next_invoice_date=date.today(),
            currency="INR",
            version=1,
        )
        db.add(sub)
        db.flush()

        line = SubscriptionLine(
            subscription_id=sub.id,
            product_id=prod.id,
            description="Seat",
            quantity=2,
            unit_price=Decimal("50.00"),
            amount=Decimal("100.00"),
        )
        db.add(line)
        db.commit()

        yield db


def test_transition_validation_gates(setup_subscription_db):
    """Verify that draft -> quotation requires lines and meeting min_quantity."""
    db = setup_subscription_db
    draft_sub = Subscription(
        number="SUB-000001",
        customer_id=1,
        plan_id=1,
        status="draft",
        start_date=date.today(),
        expiry_date=date.today() + timedelta(days=365),
        payment_term_id=1,
        billing_anchor=date.today(),
        next_invoice_date=date.today(),
        currency="INR",
        version=1,
    )
    db.add(draft_sub)
    db.commit()

    # 1. Draft without lines -> ValidationError
    with pytest.raises(ValidationError):
        transition_subscription(db, draft_sub.id, "quotation")

    # 2. Add 1 line with quantity 1 (plan requires min_quantity=2) -> ValidationError
    line = SubscriptionLine(
        subscription_id=draft_sub.id,
        product_id=1,
        description="Seat",
        quantity=1,
        unit_price=Decimal("50.00"),
        amount=Decimal("50.00"),
    )
    db.add(line)
    db.commit()

    with pytest.raises(ValidationError):
        transition_subscription(db, draft_sub.id, "quotation")

    # 3. Increase quantity to 2 -> satisfies min_quantity -> transition succeeds
    line.quantity = 2
    db.commit()
    transitioned = transition_subscription(db, draft_sub.id, "quotation")
    assert transitioned.status == "quotation"
    assert transitioned.quotation_valid_until is not None


def test_illegal_transition_and_flags(setup_subscription_db):
    """Verify illegal transitions and plan flag enforcement (allow_pause, allow_early_close)."""
    db = setup_subscription_db
    sub = db.query(Subscription).filter(Subscription.number == "SUB-999999").first()

    # Legal: quotation -> confirmed -> active
    transition_subscription(db, sub.id, "confirmed")
    transition_subscription(db, sub.id, "active")

    # Illegal: jumping directly from active to quotation
    with pytest.raises(IllegalTransitionError):
        transition_subscription(db, sub.id, "quotation")

    # Pause blocked by plan flag (allow_pause is False)
    with pytest.raises(ConflictError) as exc_info:
        transition_subscription(db, sub.id, "paused")
    assert "does not allow pausing" in str(exc_info.value.message)

    # Early close blocked by plan flag (allow_early_close is False)
    with pytest.raises(ConflictError) as exc_info:
        transition_subscription(db, sub.id, "closed")
    assert "does not permit early termination" in str(exc_info.value.message)


def test_optimistic_locking(setup_subscription_db):
    """Verify that stale version write raises ConflictError (PLAN.md 4)."""
    db = setup_subscription_db
    sub = db.query(Subscription).filter(Subscription.number == "SUB-999999").first()
    expected_v = sub.version

    # Simulate concurrent modification
    sub.version = 99
    db.commit()

    with pytest.raises(ConflictError) as exc_info:
        transition_subscription(db, sub.id, "confirmed", expected_version=expected_v)
    assert exc_info.value.code == "CONCURRENCY_CONFLICT"
