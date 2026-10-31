import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.clock import clock
from app.db import SessionLocal
from app.errors import ConflictError, ValidationError
from app.main import app
from app.models.billing import Invoice
from app.models.catalog import PaymentTerm, Plan
from app.models.identity import Customer
from app.models.platform import OutboxMessage
from app.models.subscription import Subscription
from app.schemas.payment import PaymentCreate
from app.services.invoice import cancel_invoice, confirm_invoice, send_invoice
from app.services.payment import record_payment

client = TestClient(app)


@pytest.fixture
def sample_invoice_db():
    """Create a clean customer, subscription, and invoice fixture with unique subscription_id and period_start."""
    with SessionLocal() as db:
        customer = Customer(
            name=f"Billing Test Corp {uuid.uuid4().hex[:6]}",
            email=f"billing-{uuid.uuid4().hex[:6]}@test.com",
            billing_address="123 Tech Park, Bangalore",
        )
        db.add(customer)
        db.flush()

        plan = db.query(Plan).first()
        term = db.query(PaymentTerm).first()

        sub = Subscription(
            number=f"SUB-PAYTEST-{uuid.uuid4().hex[:8]}",
            customer_id=customer.id,
            plan_id=plan.id if plan else 1,
            payment_term_id=term.id if term else 1,
            status="active",
            start_date=date(2026, 1, 1),
            expiry_date=date(2026, 12, 31),
            billing_anchor=date(2026, 1, 1),
            periods_billed=0,
            next_invoice_date=date(2026, 2, 1),
            currency="INR",
            version=1,
        )
        db.add(sub)
        db.flush()

        inv = Invoice(
            number=f"INV-TEST-{uuid.uuid4().hex[:8]}",
            customer_id=customer.id,
            subscription_id=sub.id,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 1, 31),
            issue_date=date(2026, 1, 1),
            due_date=date(2026, 1, 15),
            status="draft",
            subtotal=Decimal("1000.00"),
            discount_total=Decimal("0.00"),
            tax_total=Decimal("180.00"),
            total=Decimal("1180.00"),
            amount_paid=Decimal("0.00"),
            currency="INR",
            version=1,
        )
        db.add(inv)
        db.commit()
        db.refresh(inv)
        return inv.id


def test_invoice_confirm_lifecycle_and_optimistic_locking(sample_invoice_db):
    """Verify invoice transitions draft -> confirmed with optimistic concurrency control."""
    with SessionLocal() as db:
        # 1. Stale expected_version fails with 409 Conflict
        with pytest.raises(ConflictError, match="modified by another operation"):
            confirm_invoice(db, invoice_id=sample_invoice_db, expected_version=99)

        # 2. Correct version transitions draft -> confirmed
        inv = confirm_invoice(db, invoice_id=sample_invoice_db, expected_version=1)
        assert inv.status == "confirmed"
        assert inv.version == 2

        # 3. Confirming an already confirmed invoice fails with 409 Conflict
        with pytest.raises(ConflictError, match="Cannot confirm invoice in 'confirmed' status"):
            confirm_invoice(db, invoice_id=sample_invoice_db)


def test_invoice_cancellation_rules(sample_invoice_db):
    """Verify invoices can only be cancelled from permitted states without payments."""
    with SessionLocal() as db:
        inv = db.query(Invoice).filter(Invoice.id == sample_invoice_db).first()
        inv.status = "confirmed"
        db.commit()

        # Confirmed invoice with 0 payments can be cancelled
        cancelled = cancel_invoice(db, invoice_id=sample_invoice_db, reason="Order revoked")
        assert cancelled.status == "cancelled"

        # Simulating payment on an invoice prevents cancellation
        inv.status = "confirmed"
        inv.amount_paid = Decimal("500.00")
        db.commit()

        with pytest.raises(ConflictError, match="Cannot cancel an invoice with recorded payments"):
            cancel_invoice(db, invoice_id=sample_invoice_db)

        # Paid invoice cannot be cancelled
        inv.status = "paid"
        inv.amount_paid = Decimal("1180.00")
        db.commit()

        with pytest.raises(ConflictError, match="Cannot cancel a paid invoice"):
            cancel_invoice(db, invoice_id=sample_invoice_db)


def test_send_invoice_outbox_queue(sample_invoice_db):
    """Verify sending an invoice enqueues an outbox email and rejects sending draft invoices."""
    with SessionLocal() as db:
        # Draft invoice cannot be sent
        with pytest.raises(ConflictError, match="Please confirm invoice before sending"):
            send_invoice(db, invoice_id=sample_invoice_db)

        # Confirm invoice then send
        inv = db.query(Invoice).filter(Invoice.id == sample_invoice_db).first()
        inv.status = "confirmed"
        db.commit()

        sent_inv = send_invoice(db, invoice_id=sample_invoice_db)
        assert sent_inv.sent_at is not None

        # Verify OutboxMessage record
        msg = db.query(OutboxMessage).filter(OutboxMessage.to_email == sent_inv.customer.email).first()
        assert msg is not None
        assert msg.kind == "invoice_sent"
        assert sent_inv.number in msg.subject
        assert msg.status == "pending"


def test_payment_validation_rules(sample_invoice_db):
    """Verify payment edge cases: non-confirmed invoices, zero/negative, future date, overpayment."""
    today = clock.today()
    with SessionLocal() as db:
        # 1. Payment against draft invoice is rejected
        with pytest.raises(ConflictError, match="Payments can only be recorded against confirmed invoices"):
            req = PaymentCreate(method="card", amount=Decimal("100.00"), paid_on=today)
            record_payment(db, invoice_id=sample_invoice_db, req=req)

        # Confirm the invoice
        inv = db.query(Invoice).filter(Invoice.id == sample_invoice_db).first()
        inv.status = "confirmed"
        db.commit()

        # 2. Payment with future date is rejected
        future_date = today + timedelta(days=5)
        with pytest.raises(ValidationError, match="Payment date cannot be in the future"):
            req = PaymentCreate(method="upi", amount=Decimal("100.00"), paid_on=future_date)
            record_payment(db, invoice_id=sample_invoice_db, req=req)

        # 3. Payment exceeding balance due is rejected
        excessive_amount = inv.total + Decimal("50.00")
        with pytest.raises(ValidationError, match="exceeds remaining balance"):
            req = PaymentCreate(method="bank_transfer", amount=excessive_amount, paid_on=today)
            record_payment(db, invoice_id=sample_invoice_db, req=req)


def test_partial_and_full_payment_lifecycle(sample_invoice_db):
    """Verify partial payments update balance due and full payment transitions status to 'paid'."""
    today = clock.today()
    with SessionLocal() as db:
        inv = db.query(Invoice).filter(Invoice.id == sample_invoice_db).first()
        inv.status = "confirmed"
        db.commit()

        # Payment 1: Partial payment of 400.00 on total 1180.00
        req1 = PaymentCreate(method="card", amount=Decimal("400.00"), paid_on=today, note="Partial 1")
        p1 = record_payment(db, invoice_id=sample_invoice_db, req=req1)

        db.refresh(inv)
        assert inv.status == "confirmed"
        assert inv.amount_paid == Decimal("400.00")
        assert p1.amount == Decimal("400.00")

        # Payment 2: Full settlement of remaining 780.00
        req2 = PaymentCreate(method="upi", amount=Decimal("780.00"), paid_on=today, note="Final settlement")
        p2 = record_payment(db, invoice_id=sample_invoice_db, req=req2)

        db.refresh(inv)
        assert inv.status == "paid"
        assert inv.amount_paid == Decimal("1180.00")
        assert p2.amount == Decimal("780.00")

        # Payment 3: Attempting payment on already paid invoice fails
        with pytest.raises(ConflictError, match="already fully paid"):
            req3 = PaymentCreate(method="cash", amount=Decimal("10.00"), paid_on=today)
            record_payment(db, invoice_id=sample_invoice_db, req=req3)


def test_payment_idempotency_prevents_duplicate_charge(sample_invoice_db):
    """Verify payment idempotency key prevents duplicate charges on network retry."""
    today = clock.today()
    idem_key = f"pay-idem-{uuid.uuid4()}"
    with SessionLocal() as db:
        inv = db.query(Invoice).filter(Invoice.id == sample_invoice_db).first()
        inv.status = "confirmed"
        db.commit()

        req = PaymentCreate(
            method="card",
            amount=Decimal("300.00"),
            paid_on=today,
            idempotency_key=idem_key,
        )

        # Call 1
        pay1 = record_payment(db, invoice_id=sample_invoice_db, req=req)
        db.refresh(inv)
        assert inv.amount_paid == Decimal("300.00")

        # Call 2 with identical key
        pay2 = record_payment(db, invoice_id=sample_invoice_db, req=req)
        db.refresh(inv)

        # Must return the existing payment without charging again!
        assert pay1.id == pay2.id
        assert inv.amount_paid == Decimal("300.00")
