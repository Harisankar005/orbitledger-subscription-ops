import concurrent.futures
import uuid
from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.clock import clock
from app.db import SessionLocal
from app.main import app
from app.models.platform import IdempotencyKey
from app.services.billing import get_period_delta, run_billing_engine
from app.services.idempotency import execute_with_idempotency

client = TestClient(app)


def get_admin_token() -> str:
    login_resp = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    return login_resp.json()["access_token"]


def test_billing_run_requires_idempotency_key_header():
    """Verify that omitting Idempotency-Key header on POST /api/billing/run is rejected with 422."""
    token = get_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post("/api/billing/run", headers=headers, json={"dry_run": True})
    assert resp.status_code == 422, f"Expected 422 without Idempotency-Key, got {resp.status_code}"


def test_billing_run_twice_creates_zero():
    """Acceptance test: Running billing engine twice on the same date produces 0 new invoices on run 2 (PLAN.md 5.4)."""
    today = clock.today()
    run_billing_engine(as_of_date=today, dry_run=False)
    run2 = run_billing_engine(as_of_date=today, dry_run=False)
    assert run2.created == 0, f"Second billing run created {run2.created} duplicate invoices!"


def test_billing_idempotency_key_header():
    """Verify that repeating POST /api/billing/run with identical Idempotency-Key returns stored response."""
    token = get_admin_token()
    idem_key = f"test-key-{uuid.uuid4()}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }

    # Call 1: First request
    resp1 = client.post("/api/billing/run", headers=headers, json={"dry_run": True})
    assert resp1.status_code == 200
    data1 = resp1.json()

    # Call 2: Repeating request with same key and payload returns cached response
    resp2 = client.post("/api/billing/run", headers=headers, json={"dry_run": True})
    assert resp2.status_code == 200
    data2 = resp2.json()

    assert data1["created"] == data2["created"]
    assert data1["as_of_date"] == data2["as_of_date"]


def test_billing_idempotency_key_reuse_different_payload_rejected():
    """Verify that reusing the same Idempotency-Key with a different payload is rejected with 409 Conflict."""
    token = get_admin_token()
    idem_key = f"test-key-diff-{uuid.uuid4()}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }

    # Call 1: dry_run=True
    resp1 = client.post("/api/billing/run", headers=headers, json={"dry_run": True})
    assert resp1.status_code == 200

    # Call 2: dry_run=False (different payload!)
    resp2 = client.post("/api/billing/run", headers=headers, json={"dry_run": False})
    assert resp2.status_code == 409, f"Expected 409 on payload mismatch, got {resp2.status_code}"
    error_body = resp2.json()
    assert error_body["code"] == "IDEMPOTENCY_PAYLOAD_MISMATCH"


def test_billing_idempotency_concurrent_identical_requests():
    """Verify that two concurrent identical requests with the same key do not create duplicate operations."""
    token = get_admin_token()
    idem_key = f"test-concurrent-{uuid.uuid4()}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }
    payload = {"dry_run": True}

    def make_call():
        return client.post("/api/billing/run", headers=headers, json=payload)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(make_call)
        f2 = executor.submit(make_call)
        r1 = f1.result()
        r2 = f2.result()

    statuses = {r1.status_code, r2.status_code}
    assert 200 in statuses, "At least one concurrent request must succeed with 200"
    assert statuses.issubset({200, 409}), f"Concurrent requests must return 200 or 409, got {statuses}"

    # Once completed, repeating the request with the same key returns 200 with cached result
    repeat = client.post("/api/billing/run", headers=headers, json=payload)
    assert repeat.status_code == 200
    if 200 in [r1.status_code, r2.status_code]:
        successful = r1 if r1.status_code == 200 else r2
        assert repeat.json()["created"] == successful.json()["created"]


def test_failed_request_can_be_retried_safely():
    """Verify that a failed request does not leave a stuck in-progress key, enabling clean retries."""
    test_key = f"test-failed-{uuid.uuid4()}"
    payload = {"foo": "bar"}

    call_count = 0

    def failing_op():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("Database connection glitch")
        return {"status": "success", "attempts": call_count}

    # Attempt 1: Fails
    try:
        execute_with_idempotency(
            key=test_key,
            endpoint="/test/failing",
            payload=payload,
            operation_fn=failing_op,
        )
    except RuntimeError:
        pass

    assert call_count == 1

    # Verify no dangling in-progress key
    with SessionLocal() as db:
        key_record = db.query(IdempotencyKey).filter(IdempotencyKey.key == test_key).first()
        assert key_record is None, "Failed operation must not leave an orphaned in-progress record"

    # Attempt 2: Retry with the exact same key succeeds!
    result, was_cached = execute_with_idempotency(
        key=test_key,
        endpoint="/test/failing",
        payload=payload,
        operation_fn=failing_op,
    )
    assert result["status"] == "success"
    assert result["attempts"] == 2
    assert was_cached is False


def test_independent_runs_cannot_bill_same_period_twice():
    """Verify that independent billing runs (different idempotency keys) cannot bill the same period twice."""
    token = get_admin_token()
    today = clock.today()

    headers1 = {"Authorization": f"Bearer {token}", "Idempotency-Key": f"key-run-1-{uuid.uuid4()}"}
    headers2 = {"Authorization": f"Bearer {token}", "Idempotency-Key": f"key-run-2-{uuid.uuid4()}"}

    # Run 1
    resp1 = client.post("/api/billing/run", headers=headers1, json={"as_of_date": today.isoformat(), "dry_run": False})
    assert resp1.status_code == 200

    # Run 2 with a different key
    resp2 = client.post("/api/billing/run", headers=headers2, json={"as_of_date": today.isoformat(), "dry_run": False})
    assert resp2.status_code == 200
    # Must have created 0 duplicate invoices!
    assert resp2.json()["created"] == 0


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
