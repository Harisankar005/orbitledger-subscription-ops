import concurrent.futures
import uuid
from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models.billing import DiscountRule, Invoice, Payment
from app.models.catalog import PaymentTerm, Plan
from app.models.identity import Customer
from app.models.subscription import Subscription
from app.services.discount import try_claim_discount_usage

client = TestClient(app)


def get_admin_token() -> str:
    resp = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def test_concurrent_payments_prevent_overpayment():
    """Verify that multiple simultaneous payments against the same invoice never cause overpayment."""
    token = get_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Create a customer, plan, subscription, and invoice with total 500.00 and amount_paid 0.00
    with SessionLocal() as db:
        cust = Customer(name=f"Payee {uuid.uuid4()}", email=f"payee-{uuid.uuid4()}@brightloop.test")
        plan = Plan(
            name=f"Pay Plan {uuid.uuid4()}",
            price=Decimal("500.00"),
            billing_period="monthly",
            available_from=date(2020, 1, 1),
            available_to=date(2030, 1, 1),
        )
        term = db.query(PaymentTerm).first()
        if not term:
            term = PaymentTerm(name=f"Immediate-{uuid.uuid4().hex[:6]}", days=0)
            db.add(term)
            db.flush()

        db.add_all([cust, plan])
        db.flush()

        sub = Subscription(
            number=f"SUB-PAY-{uuid.uuid4().hex[:6]}",
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
            number=f"INV-PAY-{uuid.uuid4().hex[:6]}",
            subscription_id=sub.id,
            customer_id=cust.id,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
            issue_date=date(2026, 1, 1),
            due_date=date(2026, 1, 15),
            status="confirmed",
            subtotal=Decimal("500.00"),
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=Decimal("500.00"),
            amount_paid=Decimal("0.00"),
            currency="USD",
            version=1,
        )
        db.add(inv)
        db.commit()
        inv_id = inv.id

    def attempt_payment(worker_id: int):
        idempotency_key = f"pay-concurrent-{worker_id}-{uuid.uuid4()}"
        req_headers = {**headers, "Idempotency-Key": idempotency_key}
        payload = {
            "invoice_id": inv_id,
            "amount": "500.00",
            "method": "bank_transfer",
            "paid_on": "2026-01-10",
            "note": f"Worker {worker_id}",
        }
        return client.post("/api/payments", headers=req_headers, json=payload)

    # Launch 5 concurrent workers attempting to pay 500.00 each
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(attempt_payment, i) for i in range(5)]
        responses = [f.result() for f in futures]

    successes = [r for r in responses if r.status_code == 201]
    conflicts_or_validation = [r for r in responses if r.status_code in (400, 409)]

    # Exactly 1 payment must succeed
    assert len(successes) == 1, f"Expected 1 success, got {len(successes)}: {[r.text for r in responses]}"
    assert len(conflicts_or_validation) == 4

    # Check invoice final state in database
    with SessionLocal() as db:
        final_inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
        assert final_inv is not None
        assert final_inv.amount_paid == Decimal("500.00")
        assert final_inv.status == "paid"

        payments = db.query(Payment).filter(Payment.invoice_id == inv_id).all()
        assert len(payments) == 1


def test_concurrent_discount_usage_limit_atomic_exhaustion():
    """Verify that concurrent coupon claims strictly respect usage_limit without race conditions."""
    with SessionLocal() as db:
        rule = DiscountRule(
            name=f"CONCURRENT-COUPON-{uuid.uuid4().hex[:6]}",
            kind="fixed",
            value=Decimal("50.00"),
            min_purchase_amount=Decimal("0.00"),
            min_quantity=0,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
            usage_limit=1,  # Strictly limited to 1 claim
            used_count=0,
            scope="subscription",
            is_active=True,
        )
        db.add(rule)
        db.commit()
        rule_id = rule.id

    def attempt_claim():
        with SessionLocal() as thread_db:
            claimed = try_claim_discount_usage(thread_db, rule_id)
            if claimed:
                thread_db.commit()
            return claimed

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(attempt_claim) for _ in range(5)]
        results = [f.result() for f in futures]

    claimed_count = sum(1 for r in results if r is True)
    assert claimed_count == 1, f"Expected exactly 1 coupon claim, got {claimed_count}"

    with SessionLocal() as db:
        final_rule = db.query(DiscountRule).filter(DiscountRule.id == rule_id).first()
        assert final_rule is not None
        assert final_rule.used_count == 1
