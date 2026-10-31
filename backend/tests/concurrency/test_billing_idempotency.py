from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.clock import clock
from app.main import app
from app.services.billing import get_period_delta, run_billing_engine

client = TestClient(app)


def test_billing_run_twice_creates_zero():
    """Acceptance test: Running billing engine twice on the same date produces 0 new invoices on run 2 (PLAN.md 5.4)."""
    today = clock.today()
    # First run
    run_billing_engine(as_of_date=today, dry_run=False)
    # Second run immediately after
    run2 = run_billing_engine(as_of_date=today, dry_run=False)

    assert run2.created == 0, f"Second billing run created {run2.created} duplicate invoices!"


def test_billing_idempotency_key_header():
    """Verify that repeating POST /api/billing/run with identical Idempotency-Key returns stored response."""
    # Obtain admin auth token
    login_resp = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    token = login_resp.json()["access_token"]
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": "test-idem-key-999888777",
    }

    # Call 1
    resp1 = client.post("/api/billing/run", headers=headers, json={"dry_run": False})
    assert resp1.status_code == 200
    data1 = resp1.json()

    # Call 2 with identical key
    resp2 = client.post("/api/billing/run", headers=headers, json={"dry_run": False})
    assert resp2.status_code == 200
    data2 = resp2.json()

    # Must return exact matching cached response
    assert data1["created"] == data2["created"]
    assert data1["as_of_date"] == data2["as_of_date"]


def test_month_end_anchor_relativedelta_drift_free():
    """Verify that a Jan 31st billing anchor produces Feb 28 (or 29) then Mar 31 without iterative day drift."""
    anchor = date(2025, 1, 31)

    # Period 0 (Jan): Jan 31 to Feb 27
    start_0 = anchor + get_period_delta("monthly", 0)
    end_0 = (anchor + get_period_delta("monthly", 1)) - timedelta(days=1)
    assert start_0 == date(2025, 1, 31)
    assert end_0 == date(2025, 2, 27)

    # Period 1 (Feb): Feb 28 to Mar 30
    start_1 = anchor + get_period_delta("monthly", 1)
    end_1 = (anchor + get_period_delta("monthly", 2)) - timedelta(days=1)
    assert start_1 == date(2025, 2, 28)
    assert end_1 == date(2025, 3, 30)

    # Period 2 (Mar): Mar 31
    start_2 = anchor + get_period_delta("monthly", 2)
    assert start_2 == date(2025, 3, 31)  # Anchored cleanly back to month-end!
