from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.billing import DiscountRule
from app.services.discount import (
    calculate_raw_deduction,
    evaluate_product_line_discount,
    evaluate_subscription_discount,
    try_claim_discount_usage,
)

engine = create_engine("sqlite:///:memory:")
Base.metadata.create_all(bind=engine)
TestSession = sessionmaker(bind=engine)


def test_discount_eligibility_and_stacking():
    """Verify D-004: best single product discount and best single subscription discount."""
    with TestSession() as db:
        today = date.today()
        # Rule 1: 10% on product 1
        r1 = DiscountRule(
            name="10% Product Discount",
            kind="percent",
            value=Decimal("10.00"),
            min_purchase_amount=Decimal("100.00"),
            min_quantity=1,
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=10),
            scope="product",
            product_id=1,
            is_active=True,
        )
        # Rule 2: 20% on product 1 (higher savings)
        r2 = DiscountRule(
            name="20% Product Promo",
            kind="percent",
            value=Decimal("20.00"),
            min_purchase_amount=Decimal("100.00"),
            min_quantity=1,
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=10),
            scope="product",
            product_id=1,
            is_active=True,
        )
        # Rule 3: 50 flat subscription discount
        r3 = DiscountRule(
            name="50 Flat Subscription",
            kind="fixed",
            value=Decimal("50.00"),
            min_purchase_amount=Decimal("200.00"),
            min_quantity=1,
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=10),
            scope="subscription",
            is_active=True,
        )
        db.add_all([r1, r2, r3])
        db.commit()

        # Best product discount should pick r2 (20%) over r1 (10%)
        best_prod = evaluate_product_line_discount(
            db=db,
            product_id=1,
            quantity=2,
            line_amount=Decimal("1000.00"),
            as_of_date=today,
        )
        assert best_prod is not None
        rule, deduction = best_prod
        assert rule.id == r2.id
        assert deduction == Decimal("200.00")

        # Best subscription discount should match r3
        best_sub = evaluate_subscription_discount(
            db=db,
            subscription_id=1,
            total_quantity=2,
            post_line_subtotal=Decimal("800.00"),
            as_of_date=today,
        )
        assert best_sub is not None
        sub_rule, sub_ded = best_sub
        assert sub_rule.id == r3.id
        assert sub_ded == Decimal("50.00")


def test_atomic_usage_limit_exhaustion():
    """Verify that discount usage limit strictly halts at limit."""
    with TestSession() as db:
        today = date.today()
        limited_rule = DiscountRule(
            name="Limited 2 Uses",
            kind="fixed",
            value=Decimal("10.00"),
            start_date=today - timedelta(days=1),
            end_date=today + timedelta(days=1),
            usage_limit=2,
            used_count=0,
            scope="subscription",
            is_active=True,
        )
        db.add(limited_rule)
        db.commit()

        # Claim 1 -> success
        assert try_claim_discount_usage(db, limited_rule.id) is True
        # Claim 2 -> success
        assert try_claim_discount_usage(db, limited_rule.id) is True
        # Claim 3 -> rejected (exhausted!)
        assert try_claim_discount_usage(db, limited_rule.id) is False


def test_discount_never_exceeds_base():
    """Verify that discount deduction cannot exceed the taxable amount."""
    today = date.today()
    rule = DiscountRule(
        name="Huge Discount",
        kind="fixed",
        value=Decimal("500.00"),
        start_date=today,
        end_date=today,
        scope="subscription",
        is_active=True,
    )
    # Base amount is only 150
    ded = calculate_raw_deduction(rule, Decimal("150.00"))
    assert ded == Decimal("150.00")
