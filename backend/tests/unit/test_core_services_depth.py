import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from dateutil.relativedelta import relativedelta

from app.db import SessionLocal
from app.errors import ConflictError, NotFoundError, ValidationError
from app.models.billing import DiscountRule, Invoice, InvoiceLine
from app.models.catalog import PaymentTerm, Plan, Product, Tax
from app.models.identity import Customer
from app.models.subscription import Subscription, SubscriptionLine
from app.schemas.discount import DiscountRuleCreate, DiscountRuleUpdate
from app.services.billing import get_period_delta, run_billing_engine
from app.services.discount import (
    calculate_raw_deduction,
    create_discount_rule,
    derive_discount_status,
    evaluate_product_line_discount,
    evaluate_subscription_discount,
    update_discount_rule,
)
from app.services.invoice import (
    bulk_invoice_action,
    cancel_invoice,
    confirm_invoice,
    derive_payment_status,
    generate_invoice_html,
    send_invoice,
)
from app.services.reports import (
    calculate_normalized_mrr,
    export_report_csv,
    get_dashboard_summary,
    get_mrr_movement,
    get_revenue_by_month,
    invalidate_metrics_cache,
)


def test_get_period_delta_yearly():
    d = get_period_delta("yearly", 2)
    assert d == relativedelta(years=2)


def test_discount_status_derivations():
    today = date(2026, 6, 1)
    rule = DiscountRule(
        name="Test",
        kind="percent",
        value=Decimal("10"),
        start_date=date(2026, 1, 1),
        end_date=date(2026, 12, 31),
        is_active=False,
    )
    assert derive_discount_status(rule, today) == "Inactive"

    rule.is_active = True
    rule.usage_limit = 5
    rule.used_count = 5
    assert derive_discount_status(rule, today) == "Exhausted"

    rule.used_count = 2
    rule.end_date = date(2026, 5, 1)
    assert derive_discount_status(rule, today) == "Expired"

    rule.end_date = date(2026, 12, 31)
    rule.start_date = date(2026, 7, 1)
    assert derive_discount_status(rule, today) == "Scheduled"

    rule.start_date = date(2026, 1, 1)
    assert derive_discount_status(rule, today) == "Active"


def test_discount_crud_and_validation():
    with SessionLocal() as db:
        unique_name = f"RULE-{uuid.uuid4().hex[:6]}"
        create_req = DiscountRuleCreate(
            name=unique_name,
            kind="percent",
            value=Decimal("15"),
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            scope="subscription",
            is_active=True,
        )
        rule = create_discount_rule(db, create_req, actor_id=1)
        assert rule.id is not None
        assert rule.name == unique_name

        # Duplicate name
        with pytest.raises(ConflictError):
            create_discount_rule(db, create_req, actor_id=1)

        # Invalid dates
        bad_req = create_req.model_copy(update={"name": f"BAD-{uuid.uuid4().hex[:6]}", "start_date": date(2026, 12, 31), "end_date": date(2026, 1, 1)})
        with pytest.raises(ValidationError):
            create_discount_rule(db, bad_req, actor_id=1)

        # Product scope without product_id
        bad_prod_req = create_req.model_copy(update={"name": f"BADPROD-{uuid.uuid4().hex[:6]}", "scope": "product", "product_id": None})
        with pytest.raises(ValidationError):
            create_discount_rule(db, bad_prod_req, actor_id=1)

        # Update discount rule
        upd = DiscountRuleUpdate(value=Decimal("20"))
        updated = update_discount_rule(db, rule.id, upd, actor_id=1)
        assert updated.value == Decimal("20")

        # Update not found
        with pytest.raises(NotFoundError):
            update_discount_rule(db, 999999, upd, actor_id=1)

        # Update invalid dates
        with pytest.raises(ValidationError):
            update_discount_rule(db, rule.id, DiscountRuleUpdate(start_date=date(2027, 1, 1), end_date=date(2026, 1, 1)), actor_id=1)

        # Update product scope without product_id
        with pytest.raises(ValidationError):
            update_discount_rule(db, rule.id, DiscountRuleUpdate(scope="product", product_id=None), actor_id=1)


def test_discount_raw_deduction_and_evaluation():
    rule = DiscountRule(kind="percent", value=Decimal("10"))
    assert calculate_raw_deduction(rule, Decimal("0.00")) == Decimal("0.00")
    assert calculate_raw_deduction(rule, Decimal("-10.00")) == Decimal("0.00")

    rule_zero = DiscountRule(kind="percent", value=Decimal("0.00"))
    assert calculate_raw_deduction(rule_zero, Decimal("100.00")) == Decimal("0.00")

    # Evaluate product discount with DB query
    with SessionLocal() as db:
        prod = Product(
            name=f"Widget-{uuid.uuid4().hex[:6]}",
            type="software",
            sales_price=Decimal("100.00"),
            cost_price=Decimal("0.00"),
        )
        db.add(prod)
        db.flush()

        p_rule = DiscountRule(
            name=f"PROD-DISC-{uuid.uuid4().hex[:6]}",
            kind="fixed",
            value=Decimal("25.00"),
            scope="product",
            product_id=prod.id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            min_quantity=2,
            min_purchase_amount=Decimal("0.00"),
            is_active=True,
        )
        db.add(p_rule)
        db.commit()

        # Quantity < min_quantity
        match = evaluate_product_line_discount(db, prod.id, 1, Decimal("100.00"), date(2026, 6, 1))
        assert match is None

        # Quantity >= min_quantity
        match = evaluate_product_line_discount(db, prod.id, 2, Decimal("200.00"), date(2026, 6, 1))
        assert match is not None
        assert match[1] == Decimal("25.00")

        # Subscription discount evaluation
        s_rule = DiscountRule(
            name=f"SUB-DISC-{uuid.uuid4().hex[:6]}",
            kind="percent",
            value=Decimal("10.00"),
            scope="subscription",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            min_purchase_amount=Decimal("100.00"),
            min_quantity=0,
            is_active=True,
        )
        db.add(s_rule)
        db.commit()

        sub_match = evaluate_subscription_discount(
            db=db,
            subscription_id=1,
            total_quantity=5,
            preloaded_rules=[s_rule],
            post_line_subtotal=Decimal("50.00"),  # Below min_purchase_amount
            as_of_date=date(2026, 6, 1),
        )
        assert sub_match is None

        sub_match = evaluate_subscription_discount(
            db=db,
            subscription_id=1,
            total_quantity=5,
            preloaded_rules=[s_rule],
            post_line_subtotal=Decimal("200.00"),  # Above min_purchase_amount
            as_of_date=date(2026, 6, 1),
        )
        assert sub_match is not None
        assert sub_match[1] == Decimal("20.00")


def test_invoice_service_branches():
    with SessionLocal() as db:
        cust = Customer(name=f"Cust-{uuid.uuid4().hex[:6]}", email=f"cust-{uuid.uuid4().hex[:6]}@test.com", company="Corp Inc", tax_id="TAX-99")
        plan = db.query(Plan).first()
        term = db.query(PaymentTerm).first()
        db.add(cust)
        db.flush()

        sub = Subscription(
            number=f"SUB-INV-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=date(2026, 1, 1),
            start_date=date(2026, 1, 1),
            expiry_date=date(2030, 1, 1),
            next_invoice_date=date(2026, 2, 1),
            periods_billed=1,
            status="active",
            currency="USD",
            version=1,
        )
        db.add(sub)
        db.flush()

        inv = Invoice(
            number=f"INV-BRANCH-{uuid.uuid4().hex[:6]}",
            subscription_id=sub.id,
            customer_id=cust.id,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
            issue_date=date(2026, 1, 1),
            due_date=date(2026, 1, 15),
            status="draft",
            subtotal=Decimal("100.00"),
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=Decimal("100.00"),
            amount_paid=Decimal("0.00"),
            currency="USD",
            version=1,
        )
        db.add(inv)
        db.flush()

        line = InvoiceLine(
            invoice_id=inv.id,
            source="product",
            description="Consulting",
            quantity=1,
            unit_price=Decimal("100.00"),
            discount_amount=Decimal("0.00"),
            tax_amount=Decimal("0.00"),
            line_total=Decimal("100.00"),
        )
        db.add(line)
        db.commit()
        db.refresh(inv)

        # Derive payment status
        today = date(2026, 2, 1)
        assert derive_payment_status(inv, today) == "Draft"
        inv.status = "cancelled"
        assert derive_payment_status(inv, today) == "Cancelled"
        inv.status = "confirmed"
        assert derive_payment_status(inv, today) == "Overdue"
        inv.due_date = date(2026, 2, 15)
        assert derive_payment_status(inv, today) == "Outstanding"
        inv.amount_paid = Decimal("30.00")
        assert derive_payment_status(inv, today) == "Partially paid"
        inv.amount_paid = Decimal("100.00")
        assert derive_payment_status(inv, today) == "Paid"

        # HTML generation
        html = generate_invoice_html(inv)
        assert "Corp Inc" in html
        assert "TAX-99" in html
        assert "Consulting" in html

        # Reset for confirm/cancel/send testing
        inv.status = "draft"
        inv.amount_paid = Decimal("0.00")
        db.commit()

        # Cannot send draft invoice
        with pytest.raises(ConflictError):
            send_invoice(db, inv.id)

        # Confirm invoice with version mismatch
        with pytest.raises(ConflictError):
            confirm_invoice(db, inv.id, expected_version=99)

        # Confirm invoice successfully
        confirmed = confirm_invoice(db, inv.id, expected_version=inv.version)
        assert confirmed.status == "confirmed"

        # Cannot re-confirm confirmed invoice
        with pytest.raises(ConflictError):
            confirm_invoice(db, inv.id)

        # Send confirmed invoice
        sent = send_invoice(db, inv.id)
        assert sent.sent_at is not None

        # Cannot cancel paid invoice
        inv.status = "paid"
        db.commit()
        with pytest.raises(ConflictError):
            cancel_invoice(db, inv.id)

        # Cannot cancel invoice with payments
        inv.status = "confirmed"
        inv.amount_paid = Decimal("10.00")
        db.commit()
        with pytest.raises(ConflictError):
            cancel_invoice(db, inv.id)

        # Cancel confirmed with 0 payments
        inv.amount_paid = Decimal("0.00")
        db.commit()
        cancelled = cancel_invoice(db, inv.id, reason="Customer request")
        assert cancelled.status == "cancelled"

        # Cancel already cancelled
        assert cancel_invoice(db, inv.id).status == "cancelled"

        # NotFound errors
        with pytest.raises(NotFoundError):
            confirm_invoice(db, 999999)
        with pytest.raises(NotFoundError):
            cancel_invoice(db, 999999)
        with pytest.raises(NotFoundError):
            send_invoice(db, 999999)


def test_bulk_invoice_actions():
    with SessionLocal() as db:
        cust = db.query(Customer).first()
        sub = db.query(Subscription).first()
        inv_draft = Invoice(
            number=f"INV-BULK-{uuid.uuid4().hex[:6]}",
            subscription_id=sub.id,
            customer_id=cust.id,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
            issue_date=date(2026, 1, 1),
            due_date=date(2026, 1, 15),
            status="draft",
            subtotal=Decimal("50.00"),
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=Decimal("50.00"),
            amount_paid=Decimal("0.00"),
            currency="USD",
            version=1,
        )
        db.add(inv_draft)
        db.commit()
        db.refresh(inv_draft)

        res = bulk_invoice_action(db, [inv_draft.id], action="confirm")
        assert res.succeeded == 1
        assert res.failed == 0

        res_send = bulk_invoice_action(db, [inv_draft.id], action="send")
        assert res_send.succeeded == 1

        res_invalid = bulk_invoice_action(db, [inv_draft.id], action="unknown_op")
        assert res_invalid.failed == 1

        res_error = bulk_invoice_action(db, [999999], action="confirm")
        assert res_error.failed == 1


def test_reports_service_comprehensive():
    with SessionLocal() as db:
        # Normalized MRR
        assert calculate_normalized_mrr(Decimal("10.00"), "daily") == Decimal("300.00")
        assert calculate_normalized_mrr(Decimal("120.00"), "weekly") == Decimal("520.00")
        assert calculate_normalized_mrr(Decimal("100.00"), "monthly") == Decimal("100.00")
        assert calculate_normalized_mrr(Decimal("1200.00"), "yearly") == Decimal("100.00")
        assert calculate_normalized_mrr(Decimal("50.00"), "unknown") == Decimal("50.00")

        # Dashboard summary with filters and caching
        invalidate_metrics_cache()
        s1 = get_dashboard_summary(db, date_from=date(2025, 1, 1), date_to=date(2030, 1, 1))
        assert "mrr" in s1
        assert "aging_buckets" in s1

        # Hit cache
        s2 = get_dashboard_summary(db, date_from=date(2025, 1, 1), date_to=date(2030, 1, 1))
        assert s2 == s1

        # Revenue by month and MRR movement
        rev = get_revenue_by_month(db)
        assert isinstance(rev, list)
        movement = get_mrr_movement(db)
        assert "new_mrr" in movement
        assert "net_mrr" in movement

        # Export CSVs
        overdue_csv = export_report_csv(db, "overdue")
        assert "Invoice Number" in overdue_csv
        payments_csv = export_report_csv(db, "payments")
        assert "Payment ID" in payments_csv
        invalid_csv = export_report_csv(db, "unknown_report")
        assert "Invalid report kind" in invalid_csv


def test_billing_branches_paused_expired_lines_and_isolation():
    with SessionLocal() as db:
        cust = Customer(name=f"BillingCust-{uuid.uuid4().hex[:6]}", email=f"bcust-{uuid.uuid4().hex[:6]}@test.com")
        term = PaymentTerm(name=f"Term-{uuid.uuid4().hex[:6]}", days=10)
        tax = Tax(name=f"Tax-{uuid.uuid4().hex[:6]}", rate=Decimal("10.00"), is_active=True)
        prod = Product(
            name=f"SaaS Addon-{uuid.uuid4().hex[:6]}",
            type="addon",
            sales_price=Decimal("50.00"),
            cost_price=Decimal("0.00"),
        )
        plan = Plan(
            name=f"Pro Plan-{uuid.uuid4().hex[:6]}",
            price=Decimal("100.00"),
            billing_period="monthly",
            available_from=date(2020, 1, 1),
            available_to=date(2030, 1, 1),
            default_tax=tax,
        )
        db.add_all([cust, term, tax, prod, plan])
        db.flush()

        # 1. Paused subscription should be skipped
        sub_paused = Subscription(
            number=f"SUB-PAUSED-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=date(2026, 1, 1),
            start_date=date(2026, 1, 1),
            expiry_date=date(2030, 1, 1),
            next_invoice_date=date(2026, 2, 1),
            periods_billed=1,
            status="paused",
            currency="USD",
            version=1,
        )

        # 2. Closed subscription should be skipped
        sub_closed = Subscription(
            number=f"SUB-CLOSED-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=date(2026, 1, 1),
            start_date=date(2026, 1, 1),
            expiry_date=date(2026, 1, 15),
            next_invoice_date=date(2026, 2, 1),
            periods_billed=1,
            status="closed",
            currency="USD",
            version=1,
        )

        # 3. Active subscription with product lines and active discounts
        sub_active = Subscription(
            number=f"SUB-ACTIVE-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=date(2026, 1, 1),
            start_date=date(2026, 1, 1),
            expiry_date=date(2030, 1, 1),
            next_invoice_date=date(2026, 2, 1),
            periods_billed=1,
            status="active",
            currency="USD",
            version=1,
        )
        db.add_all([sub_paused, sub_closed, sub_active])
        db.flush()

        sub_line = SubscriptionLine(
            subscription_id=sub_active.id,
            product_id=prod.id,
            description="Addon license",
            quantity=2,
            unit_price=Decimal("50.00"),
            amount=Decimal("100.00"),
            tax_id=tax.id,
        )
        db.add(sub_line)

        # Add product discount
        p_disc = DiscountRule(
            name=f"LINE-DISC-{uuid.uuid4().hex[:6]}",
            kind="fixed",
            value=Decimal("10.00"),
            scope="product",
            product_id=prod.id,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            min_quantity=1,
            is_active=True,
        )
        # Add subscription discount
        s_disc = DiscountRule(
            name=f"INVOICE-DISC-{uuid.uuid4().hex[:6]}",
            kind="fixed",
            value=Decimal("20.00"),
            scope="subscription",
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            target_subscription_id=sub_active.id,
            is_active=True,
        )
        db.add_all([p_disc, s_disc])
        db.commit()

        # Run billing engine dry run
        dry_res = run_billing_engine(as_of_date=date(2026, 2, 1), dry_run=True)
        assert dry_res.dry_run is True
        assert dry_res.created >= 1

        # Run billing engine real run
        real_res = run_billing_engine(as_of_date=date(2026, 2, 1), dry_run=False)
        assert real_res.dry_run is False
        assert real_res.created >= 1

        # Verify created invoice has product line and both discounts
        inv = db.query(Invoice).filter(Invoice.subscription_id == sub_active.id).order_by(Invoice.id.desc()).first()
        assert inv is not None
        assert len(inv.lines) == 2  # Plan line + Addon line
        assert len(inv.applied_discounts) >= 1

        # Test skipped_already_billed: pre-create invoice for next_invoice_date period
        sub_skip = Subscription(
            number=f"SUB-SKIP-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=date(2026, 5, 1),
            start_date=date(2026, 5, 1),
            expiry_date=date(2030, 1, 1),
            next_invoice_date=date(2026, 6, 1),
            periods_billed=1,
            status="active",
            currency="USD",
            version=1,
        )
        db.add(sub_skip)
        db.flush()

        existing_inv = Invoice(
            number=f"INV-PRE-{uuid.uuid4().hex[:6]}",
            subscription_id=sub_skip.id,
            customer_id=cust.id,
            period_start=date(2026, 6, 1),
            period_end=date(2026, 6, 30),
            issue_date=date(2026, 6, 1),
            due_date=date(2026, 6, 15),
            status="confirmed",
            subtotal=Decimal("100.00"),
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=Decimal("100.00"),
            amount_paid=Decimal("0.00"),
            currency="USD",
            version=1,
        )
        db.add(existing_inv)
        db.commit()

        skip_res = run_billing_engine(as_of_date=date(2026, 6, 1), dry_run=False)
        assert skip_res.skipped_already_billed >= 1

        # Test failure isolation: mock a failure for one sub during billing run
        sub_fail = Subscription(
            number=f"SUB-FAIL-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=date(2026, 3, 1),
            start_date=date(2026, 3, 1),
            expiry_date=date(2030, 1, 1),
            next_invoice_date=date(2026, 4, 1),
            periods_billed=1,
            status="active",
            currency="USD",
            version=1,
        )
        db.add(sub_fail)
        db.commit()

        with patch("app.services.billing.generate_next_number", side_effect=Exception("Database lock failure")):
            fail_res = run_billing_engine(as_of_date=date(2026, 4, 1), dry_run=False)
            assert len(fail_res.failed) >= 1
            assert any(f.subscription_id == sub_fail.id for f in fail_res.failed)
