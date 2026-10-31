from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.clock import clock
from app.db import SessionLocal
from app.main import app
from app.models.billing import Invoice
from app.models.identity import Customer, User
from app.models.subscription import Subscription
from app.security import hash_password
from app.services.reports import invalidate_metrics_cache


@pytest.fixture
def api_client():
    return TestClient(app)


@pytest.fixture
def auth_headers(api_client):
    with SessionLocal() as db:
        admin = db.query(User).filter(User.email == "admin_overdue_test@brightloop.test").first()
        if not admin:
            admin = User(
                email="admin_overdue_test@brightloop.test",
                password_hash=hash_password("Admin@1234"),
                role="admin",
                full_name="Admin Overdue Test",
                is_active=True,
            )
            db.add(admin)
            db.commit()

    res = api_client.post(
        "/api/auth/login",
        json={"email": "admin_overdue_test@brightloop.test", "password": "Admin@1234"},
    )
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_overdue_consistency_across_dashboard_list_and_csv(api_client, auth_headers):
    """Assert that dashboard overdue_count equals /api/invoices?status=overdue total equals CSV row count."""
    invalidate_metrics_cache()

    # 1. Dashboard summary
    summary_res = api_client.get("/api/reports/summary", headers=auth_headers)
    assert summary_res.status_code == 200, summary_res.text
    summary = summary_res.json()

    overdue_count = summary["overdue_count"]
    overdue_total = summary["overdue_total"]
    aging = summary["aging_buckets"]

    # In a seeded system, overdue invoices should exist in all 3 aging buckets
    assert overdue_count > 0, "Expected seeded overdue invoices"
    assert overdue_total > 0, "Expected non-zero overdue total"
    assert aging["1_30_days"] > 0, f"Expected positive bucket 1-30, got {aging['1_30_days']}"
    assert aging["31_60_days"] > 0, f"Expected positive bucket 31-60, got {aging['31_60_days']}"
    assert aging["61_plus_days"] > 0, f"Expected positive bucket 61+, got {aging['61_plus_days']}"

    # Sum of buckets equals overdue_total
    bucket_sum = round(aging["1_30_days"] + aging["31_60_days"] + aging["61_plus_days"], 2)
    assert bucket_sum == round(overdue_total, 2), f"Bucket sum {bucket_sum} != overdue_total {overdue_total}"

    # 2. Invoices list query with status=overdue
    invoices_res = api_client.get("/api/invoices?status=overdue&page_size=100", headers=auth_headers)
    assert invoices_res.status_code == 200, invoices_res.text
    invoices_data = invoices_res.json()
    invoices_total = invoices_data["total"]

    # 3. Dedicated paginated reports endpoint GET /api/reports/overdue
    report_res = api_client.get("/api/reports/overdue?page_size=100", headers=auth_headers)
    assert report_res.status_code == 200, report_res.text
    report_data = report_res.json()
    report_total = report_data["total"]

    # 4. CSV export of overdue report
    csv_res = api_client.get("/api/reports/export/overdue.csv", headers=auth_headers)
    assert csv_res.status_code == 200, csv_res.text
    csv_lines = [line for line in csv_res.text.strip().split("\n") if line.strip()]
    assert len(csv_lines) >= 1, "CSV output must contain header line"
    header = csv_lines[0]
    data_rows = csv_lines[1:]

    assert "Invoice Number" in header
    assert "Days Overdue" in header
    assert "Balance Due" in header

    # Strict consistency assertion
    assert (
        overdue_count == invoices_total == report_total == len(data_rows)
    ), f"Mismatch: summary={overdue_count}, list={invoices_total}, report={report_total}, csv={len(data_rows)}"

    # Check that items in /api/reports/overdue carry days_overdue and amount_due
    today = clock.today()
    for item in report_data["items"]:
        assert item["payment_status"] == "Overdue"
        assert item["days_overdue"] is not None
        assert item["days_overdue"] == (today - date.fromisoformat(item["due_date"])).days
        assert item["days_overdue"] > 0
        assert item["amount_due"] is not None
        assert Decimal(str(item["amount_due"])) > Decimal("0.00")


def test_draft_invoices_never_appear_in_outstanding_or_overdue(api_client, auth_headers):
    """Assert that draft invoices (even with due_date < today) never appear in outstanding, overdue count, or CSV."""
    invalidate_metrics_cache()
    today = clock.today()

    # Get baseline summary
    base_summary = api_client.get("/api/reports/summary", headers=auth_headers).json()
    base_outstanding = Decimal(str(base_summary["total_outstanding"]))
    base_overdue_count = base_summary["overdue_count"]
    base_overdue_total = Decimal(str(base_summary["overdue_total"]))

    # Insert a draft invoice with past due date and substantial balance
    draft_number = f"INV-DRAFT-{int(clock.now().timestamp() * 1000)}"
    draft_total = Decimal("75000.00")

    with SessionLocal() as db:
        cust = db.query(Customer).first()
        sub = db.query(Subscription).first()
        assert cust and sub, "Seeded customer and subscription must exist"

        draft_invoice = Invoice(
            number=draft_number,
            subscription_id=sub.id,
            customer_id=cust.id,
            period_start=today - timedelta(days=60),
            period_end=today - timedelta(days=31),
            issue_date=today - timedelta(days=60),
            due_date=today - timedelta(days=45),  # 45 days past due, but status is DRAFT!
            status="draft",
            subtotal=draft_total,
            discount_total=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            total=draft_total,
            amount_paid=Decimal("0.00"),
            currency="INR",
            version=1,
        )
        db.add(draft_invoice)
        db.commit()
        draft_id = draft_invoice.id

    try:
        invalidate_metrics_cache()

        # 1. Check summary metrics: draft invoice must NOT be counted in outstanding or overdue
        new_summary = api_client.get("/api/reports/summary", headers=auth_headers).json()
        assert Decimal(str(new_summary["total_outstanding"])) == base_outstanding, (
            f"Draft invoice was included in total_outstanding! "
            f"Expected {base_outstanding}, got {new_summary['total_outstanding']}"
        )
        assert new_summary["overdue_count"] == base_overdue_count, "Draft invoice incremented overdue_count!"
        assert Decimal(str(new_summary["overdue_total"])) == base_overdue_total, "Draft invoice incremented overdue_total!"

        # 2. Check /api/invoices?status=overdue: draft invoice must not appear
        inv_res = api_client.get("/api/invoices?status=overdue&page_size=100", headers=auth_headers).json()
        assert inv_res["total"] == base_overdue_count
        assert not any(i["id"] == draft_id for i in inv_res["items"])

        # 3. Check /api/reports/overdue: draft invoice must not appear
        rep_res = api_client.get("/api/reports/overdue?page_size=100", headers=auth_headers).json()
        assert rep_res["total"] == base_overdue_count
        assert not any(i["id"] == draft_id for i in rep_res["items"])

        # 4. Check CSV export: draft invoice must not appear
        csv_res = api_client.get("/api/reports/export/overdue.csv", headers=auth_headers)
        assert draft_number not in csv_res.text

        # 5. Now confirm the invoice: status becomes confirmed
        confirm_res = api_client.post(f"/api/invoices/{draft_id}/confirm", headers=auth_headers)
        assert confirm_res.status_code == 200, confirm_res.text
        assert confirm_res.json()["status"] == "confirmed"

        invalidate_metrics_cache()

        # 6. Once confirmed, it MUST appear in outstanding and overdue!
        confirmed_summary = api_client.get("/api/reports/summary", headers=auth_headers).json()
        assert Decimal(str(confirmed_summary["total_outstanding"])) == base_outstanding + draft_total
        assert confirmed_summary["overdue_count"] == base_overdue_count + 1
        assert Decimal(str(confirmed_summary["overdue_total"])) == base_overdue_total + draft_total

        # And appears in invoices, reports, and CSV
        inv_confirmed_res = api_client.get("/api/invoices?status=overdue&page_size=100", headers=auth_headers).json()
        assert inv_confirmed_res["total"] == base_overdue_count + 1
        assert any(i["id"] == draft_id for i in inv_confirmed_res["items"])

        csv_confirmed_res = api_client.get("/api/reports/export/overdue.csv", headers=auth_headers)
        assert draft_number in csv_confirmed_res.text

    finally:
        with SessionLocal() as db:
            inv_to_del = db.query(Invoice).filter(Invoice.id == draft_id).first()
            if inv_to_del:
                db.delete(inv_to_del)
                db.commit()
        invalidate_metrics_cache()
