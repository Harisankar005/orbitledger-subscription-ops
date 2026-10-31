import concurrent.futures
import os
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.db as app_db
import app.services.billing as billing_service
import app.services.idempotency as idempotency_service
from app.clock import clock
from app.db import Base, get_db
from app.errors import ConflictError
from app.main import app
from app.models.billing import Invoice, NumberCounter
from app.models.catalog import PaymentTerm, Plan
from app.models.identity import Customer, User
from app.models.platform import IdempotencyKey
from app.models.subscription import Subscription
from app.security import hash_password
from app.services.billing import get_period_delta, run_billing_engine
from app.services.idempotency import (
    IN_PROGRESS_MARKER,
    compute_canonical_hash,
    execute_with_idempotency,
)

TEST_DB_PATH = "./test_concurrency_controlled.db"
TEST_DB_URL = f"sqlite:///{TEST_DB_PATH}"

test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

orig_session_local = app_db.SessionLocal
orig_engine = app_db.engine
orig_billing_session = billing_service.SessionLocal
orig_idem_session = idempotency_service.SessionLocal


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


client = TestClient(app)


@pytest.fixture(scope="module", autouse=True)
def setup_controlled_database():
    """Create a clean, isolated database schema with deterministic base entities."""
    app_db.SessionLocal = TestSessionLocal
    app_db.engine = test_engine
    billing_service.SessionLocal = TestSessionLocal
    idempotency_service.SessionLocal = TestSessionLocal
    app.dependency_overrides[get_db] = override_get_db

    Base.metadata.drop_all(bind=test_engine)
    Base.metadata.create_all(bind=test_engine)

    with TestSessionLocal() as db:
        admin = User(
            email="admin@brightloop.test",
            password_hash=hash_password("Admin@1234"),
            role="admin",
            full_name="Admin Vance",
            is_active=True,
        )
        cust = Customer(name="Acme Corp", email="acme@brightloop.test")
        term = PaymentTerm(name="Immediate", days=0)
        db.add_all([admin, cust, term])
        db.flush()

        plan = Plan(
            name="Professional SaaS",
            billing_period="monthly",
            price=Decimal("1500.00"),
            available_from=date(2025, 1, 1),
            available_to=date(2035, 12, 31),
            allow_pause=True,
            allow_renew=True,
            allow_early_close=True,
            auto_close_on_end=False,
        )
        db.add(plan)
        db.flush()

        db.add(NumberCounter(name="SUB", next_value=1))
        db.add(NumberCounter(name="INV", next_value=1))
        db.commit()

    yield

    app_db.SessionLocal = orig_session_local
    app_db.engine = orig_engine
    billing_service.SessionLocal = orig_billing_session
    idempotency_service.SessionLocal = orig_idem_session
    app.dependency_overrides.pop(get_db, None)

    test_engine.dispose()
    if os.path.exists(TEST_DB_PATH):
        try:
            os.remove(TEST_DB_PATH)
        except OSError:
            pass


def get_admin_token() -> str:
    login_resp = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    return login_resp.json()["access_token"]


def create_test_subscription(start_date: date, next_invoice_date: date) -> int:
    """Helper to create an active subscription for non-dry-run billing tests."""
    with TestSessionLocal() as db:
        cust = db.query(Customer).first()
        plan = db.query(Plan).first()
        term = db.query(PaymentTerm).first()
        sub = Subscription(
            number=f"SUB-TEST-{uuid.uuid4().hex[:6]}",
            customer_id=cust.id,
            plan_id=plan.id,
            payment_term_id=term.id,
            billing_anchor=start_date,
            start_date=start_date,
            next_invoice_date=next_invoice_date,
            expiry_date=start_date + timedelta(days=365),
            status="active",
            periods_billed=0,
            currency="INR",
            version=1,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)
        return sub.id


def test_billing_run_requires_idempotency_key_header():
    """Verify that omitting Idempotency-Key header on POST /api/billing/run is rejected with 422."""
    token = get_admin_token()
    headers = {"Authorization": f"Bearer {token}"}
    resp = client.post("/api/billing/run", headers=headers, json={"dry_run": True})
    assert resp.status_code == 422, f"Expected 422 without Idempotency-Key, got {resp.status_code}"


def test_billing_idempotency_repeat_returns_cached():
    """Verify that repeating POST /api/billing/run with identical Idempotency-Key returns stored response."""
    token = get_admin_token()
    idem_key = f"test-key-{uuid.uuid4()}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": idem_key,
    }
    payload = {"as_of_date": "2026-03-01", "dry_run": True}

    # Call 1: First request
    resp1 = client.post("/api/billing/run", headers=headers, json=payload)
    assert resp1.status_code == 200
    data1 = resp1.json()

    # Call 2: Repeating request with same key and payload returns cached response
    resp2 = client.post("/api/billing/run", headers=headers, json=payload)
    assert resp2.status_code == 200
    data2 = resp2.json()

    assert data1["created"] == data2["created"]
    assert data1["as_of_date"] == data2["as_of_date"]


def test_billing_idempotency_payload_mismatch_rejected():
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


def test_cross_endpoint_idempotency_scope_isolation():
    """Verify that using the same idempotency key across billing and payment scopes does not collide or cross-return cached responses."""
    token = get_admin_token()
    shared_key = f"shared-cross-scope-{uuid.uuid4()}"

    # 1. Run billing with shared_key
    billing_headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": shared_key,
    }
    billing_resp = client.post("/api/billing/run", headers=billing_headers, json={"as_of_date": "2026-04-01", "dry_run": True})
    assert billing_resp.status_code == 200
    billing_data = billing_resp.json()
    assert "duration_ms" in billing_data

    # 2. Create a confirmed invoice to receive payment
    target_date = date(2026, 4, 15)
    sub_id = create_test_subscription(start_date=target_date, next_invoice_date=target_date)
    # Bill it to create an invoice
    run_billing_engine(as_of_date=target_date, dry_run=False)

    with TestSessionLocal() as db:
        inv = db.query(Invoice).filter(Invoice.subscription_id == sub_id).first()
        assert inv is not None
        inv.status = "confirmed"
        db.commit()
        invoice_id = inv.id

    # 3. Record payment using the EXACT SAME shared_key on payments endpoint
    payment_headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": shared_key,
    }
    payment_payload = {
        "invoice_id": invoice_id,
        "amount": "500.00",
        "method": "upi",
        "paid_on": str(clock.today()),
    }
    payment_resp = client.post("/api/payments", headers=payment_headers, json=payment_payload)
    assert payment_resp.status_code == 201
    payment_data = payment_resp.json()

    # The payment response must NOT be the cached billing response!
    assert "amount" in payment_data
    assert payment_data["amount"] == "500.00"
    assert "duration_ms" not in payment_data

    # 4. Verify DB stores two distinct rows under UNIQUE(scope, key)
    with TestSessionLocal() as db:
        keys = db.query(IdempotencyKey).filter(IdempotencyKey.key == shared_key).all()
        assert len(keys) == 2
        scopes = {k.scope for k in keys}
        assert scopes == {"billing.run", "payments.record"}

    # 5. Replay billing run with shared_key: returns the billing cached response!
    billing_repeat = client.post("/api/billing/run", headers=billing_headers, json={"as_of_date": "2026-04-01", "dry_run": True})
    assert billing_repeat.status_code == 200
    assert billing_repeat.json() == billing_data


def test_real_concurrent_billing_with_same_key_single_execution():
    """Verify that concurrent non-dry-run requests with the SAME key execute exactly one logical billing run."""
    target_date = date(2026, 5, 1)
    sub_id = create_test_subscription(start_date=target_date, next_invoice_date=target_date)

    token = get_admin_token()
    same_key = f"conc-same-key-{uuid.uuid4()}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Idempotency-Key": same_key,
    }
    payload = {"as_of_date": target_date.isoformat(), "dry_run": False}

    def do_call():
        return client.post("/api/billing/run", headers=headers, json=payload)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_call)
        f2 = executor.submit(do_call)
        r1 = f1.result()
        r2 = f2.result()

    statuses = {r1.status_code, r2.status_code}
    assert 200 in statuses, "At least one concurrent request must succeed with 200"
    assert statuses.issubset({200, 409}), f"Concurrent requests must return 200 or 409, got {statuses}"

    # Verify that in the database, exactly ONE invoice was created for this subscription and period!
    with TestSessionLocal() as db:
        invoices = db.query(Invoice).filter(Invoice.subscription_id == sub_id, Invoice.period_start == target_date).all()
        assert len(invoices) == 1, f"Expected exactly 1 invoice, found {len(invoices)} (duplicate detected!)"

    # Replaying request returns cached completed result
    repeat = client.post("/api/billing/run", headers=headers, json=payload)
    assert repeat.status_code == 200


def test_real_concurrent_billing_with_different_keys_no_double_bill():
    """Verify that concurrent non-dry-run requests with DIFFERENT keys cannot bill the same subscription period twice."""
    target_date = date(2026, 6, 1)
    sub_id = create_test_subscription(start_date=target_date, next_invoice_date=target_date)

    token = get_admin_token()
    key_alpha = f"conc-diff-alpha-{uuid.uuid4()}"
    key_beta = f"conc-diff-beta-{uuid.uuid4()}"

    def do_call(key: str):
        headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": key}
        return client.post("/api/billing/run", headers=headers, json={"as_of_date": target_date.isoformat(), "dry_run": False})

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(do_call, key_alpha)
        f2 = executor.submit(do_call, key_beta)
        r1 = f1.result()
        r2 = f2.result()

    assert r1.status_code == 200
    assert r2.status_code == 200

    # Exactly one invoice exists in the database for sub_id and target_date
    with TestSessionLocal() as db:
        invoices = db.query(Invoice).filter(Invoice.subscription_id == sub_id, Invoice.period_start == target_date).all()
        assert len(invoices) == 1, f"Database integrity violation: found {len(invoices)} duplicate invoices!"

    # Subsequent run on same date bills 0 new invoices
    subsequent = client.post(
        "/api/billing/run",
        headers={"Authorization": f"Bearer {token}", "Idempotency-Key": f"key-subsequent-{uuid.uuid4()}"},
        json={"as_of_date": target_date.isoformat(), "dry_run": False},
    )
    assert subsequent.status_code == 200
    assert subsequent.json()["created"] == 0


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
            scope="test.scope",
        )
    except RuntimeError:
        pass

    assert call_count == 1

    # Verify no dangling in-progress key
    with TestSessionLocal() as db:
        key_record = db.query(IdempotencyKey).filter(IdempotencyKey.key == test_key).first()
        assert key_record is None, "Failed operation must not leave an orphaned in-progress record"

    # Attempt 2: Retry with the exact same key succeeds!
    result, was_cached = execute_with_idempotency(
        key=test_key,
        endpoint="/test/failing",
        payload=payload,
        operation_fn=failing_op,
        scope="test.scope",
    )
    assert result["status"] == "success"
    assert result["attempts"] == 2
    assert was_cached is False


def test_stale_in_progress_record_recovery_strategy():
    """Verify documented recovery strategy: an abandoned/crashed in-progress record older than 60s is safely re-claimed."""
    stale_key = f"stale-test-key-{uuid.uuid4()}"
    scope = "billing.run"
    payload = {"as_of_date": "2026-07-01", "dry_run": True}
    req_hash = compute_canonical_hash(payload)

    # Seed a simulated crashed worker's in-progress record from 120 seconds ago
    with TestSessionLocal() as db:
        old_time = datetime.now(timezone.utc) - timedelta(seconds=120)
        stale_record = IdempotencyKey(
            scope=scope,
            key=stale_key,
            endpoint="/api/billing/run",
            request_hash=req_hash,
            response_json=IN_PROGRESS_MARKER,
            status="in_progress",
            created_at=old_time,
            updated_at=old_time,
        )
        db.add(stale_record)
        db.commit()

    # Execute retry operation using the same key and payload
    result, was_cached = execute_with_idempotency(
        key=stale_key,
        endpoint="/api/billing/run",
        payload=payload,
        operation_fn=lambda: {"recovered": True, "created": 1},
        scope=scope,
        stale_timeout_seconds=60.0,
    )

    assert was_cached is False
    assert result["recovered"] is True

    # Check that in DB the record is now completed
    with TestSessionLocal() as db:
        updated = db.query(IdempotencyKey).filter(IdempotencyKey.scope == scope, IdempotencyKey.key == stale_key).first()
        assert updated is not None
        assert updated.status == "completed"
        assert updated.response_json != IN_PROGRESS_MARKER


def test_in_progress_record_cannot_be_mistaken_for_completed():
    """Verify that an active in-progress record is never parsed or returned as a completed response."""
    active_key = f"active-in-progress-{uuid.uuid4()}"
    scope = "billing.run"
    payload = {"test": "payload"}
    req_hash = compute_canonical_hash(payload)

    with TestSessionLocal() as db:
        in_progress = IdempotencyKey(
            scope=scope,
            key=active_key,
            endpoint="/api/billing/run",
            request_hash=req_hash,
            response_json=IN_PROGRESS_MARKER,
            status="in_progress",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(in_progress)
        db.commit()

    # Sibling request with max_wait_seconds=0.1 must timeout and raise 409 Conflict, NEVER return in-progress marker
    with pytest.raises(ConflictError) as exc_info:
        execute_with_idempotency(
            key=active_key,
            endpoint="/api/billing/run",
            payload=payload,
            operation_fn=lambda: {"should_not_run": True},
            scope=scope,
            max_wait_seconds=0.1,
            stale_timeout_seconds=60.0,
        )

    assert exc_info.value.code == "IDEMPOTENCY_IN_PROGRESS"


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


def test_billing_run_twice_creates_zero():
    """Acceptance test: Running billing engine twice on the same date produces 0 new invoices on run 2 (PLAN.md 5.4)."""
    target_date = date(2026, 8, 1)
    create_test_subscription(start_date=target_date, next_invoice_date=target_date)

    run1 = run_billing_engine(as_of_date=target_date, dry_run=False)
    assert run1.created >= 1
    run2 = run_billing_engine(as_of_date=target_date, dry_run=False)
    assert run2.created == 0, f"Second billing run created {run2.created} duplicate invoices!"


def test_multiple_workers_competing_for_stale_record_atomic_lease():
    """Verify that when multiple concurrent workers attempt to recover the same stale record, exactly one wins the lease."""
    stale_key = f"stale-compete-{uuid.uuid4()}"
    scope = "billing.run"
    endpoint = "/api/billing/run"
    payload = {"as_of_date": "2026-09-01", "dry_run": True}
    req_hash = compute_canonical_hash(payload)

    # Seed an abandoned in-progress record from 120s ago
    with TestSessionLocal() as db:
        old_time = datetime.now(timezone.utc) - timedelta(seconds=120)
        stale_record = IdempotencyKey(
            scope=scope,
            key=stale_key,
            endpoint=endpoint,
            request_hash=req_hash,
            response_json=IN_PROGRESS_MARKER,
            status="in_progress",
            created_at=old_time,
            updated_at=old_time,
        )
        db.add(stale_record)
        db.commit()

    execution_count = 0
    import threading
    lock = threading.Lock()

    def do_work():
        nonlocal execution_count
        with lock:
            execution_count += 1
        time.sleep(0.05)
        return {"winner": True, "count": execution_count}

    def worker_task():
        res, was_cached = execute_with_idempotency(
            key=stale_key,
            endpoint=endpoint,
            payload=payload,
            operation_fn=do_work,
            scope=scope,
            max_wait_seconds=5.0,
            stale_timeout_seconds=5.0,
        )
        return res, was_cached

    # Launch 5 concurrent workers simultaneously
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(worker_task) for _ in range(5)]
        results = [f.result() for f in futures]

    # Exactly ONE worker executed do_work()!
    assert execution_count == 1, f"Expected exactly 1 execution among competing workers, got {execution_count}"

    # All workers received valid results
    cached_flags = [was_cached for _, was_cached in results]
    assert False in cached_flags, "The winning worker must have was_cached=False"
    assert True in cached_flags, "Losing workers must have received was_cached=True"

    # Database record is completed
    with TestSessionLocal() as db:
        record = db.query(IdempotencyKey).filter(IdempotencyKey.scope == scope, IdempotencyKey.key == stale_key).first()
        assert record is not None
        assert record.status == "completed"
        assert record.response_json != IN_PROGRESS_MARKER


def test_interrupted_operation_simulation_and_stale_recovery():
    """Verify that an interrupted worker (e.g. process termination) leaving an in-progress record recovers safely."""
    key = f"interrupted-{uuid.uuid4()}"
    scope = "payments.record"
    endpoint = "/api/payments"
    payload = {"invoice_id": 1, "amount": "500.00"}
    req_hash = compute_canonical_hash(payload)

    # Simulate a worker claiming in-progress reservation and abruptly crashing 10 seconds ago
    crash_time = datetime.now(timezone.utc) - timedelta(seconds=10)
    with TestSessionLocal() as db:
        abandoned = IdempotencyKey(
            scope=scope,
            key=key,
            endpoint=endpoint,
            request_hash=req_hash,
            response_json=IN_PROGRESS_MARKER,
            status="in_progress",
            created_at=crash_time,
            updated_at=crash_time,
        )
        db.add(abandoned)
        db.commit()

    # Retry with stale_timeout=30s and max_wait=0.05s: rejected as active in progress
    with pytest.raises(ConflictError) as exc:
        execute_with_idempotency(
            key=key,
            endpoint=endpoint,
            payload=payload,
            operation_fn=lambda: {"paid": True},
            scope=scope,
            max_wait_seconds=0.05,
            stale_timeout_seconds=30.0,
        )
    assert exc.value.code == "IDEMPOTENCY_IN_PROGRESS"

    # Now retry with stale_timeout=5.0s (crash was 10s ago, so it is stale!): recovers and executes!
    result, was_cached = execute_with_idempotency(
        key=key,
        endpoint=endpoint,
        payload=payload,
        operation_fn=lambda: {"paid": True, "recovered": True},
        scope=scope,
        max_wait_seconds=1.0,
        stale_timeout_seconds=5.0,
    )
    assert was_cached is False
    assert result["paid"] is True
    assert result["recovered"] is True


def test_cache_persistence_failure_never_fabricates_response_and_prevents_duplicate_side_effects():
    """Verify that if response caching fails, no fabricated response is returned and retries do not duplicate side effects."""
    key = f"key-cache-fail-{uuid.uuid4()}"
    endpoint = "/api/billing/run"
    scope = "billing.run"
    payload = {"dry_run": False}
    side_effects_run = 0

    def billing_operation():
        nonlocal side_effects_run
        side_effects_run += 1
        return {"created": 5, "duration_ms": 12}

    # Execute successfully
    res, was_cached = execute_with_idempotency(
        key=key,
        endpoint=endpoint,
        payload=payload,
        operation_fn=billing_operation,
        scope=scope,
    )
    assert was_cached is False
    assert res == {"created": 5, "duration_ms": 12}
    assert side_effects_run == 1

    # Simulate corrupted / failed response cache persistence on the record in DB
    with TestSessionLocal() as db:
        rec = db.query(IdempotencyKey).filter(IdempotencyKey.scope == scope, IdempotencyKey.key == key).first()
        assert rec is not None
        assert rec.status == "completed"
        # Set response_json to CACHE_UNAVAILABLE_MARKER (simulating response cache write failure)
        rec.response_json = idempotency_service.CACHE_UNAVAILABLE_MARKER
        db.commit()

    # Retry 1: Client retries with the exact same key and payload
    with pytest.raises(ConflictError) as exc_info:
        execute_with_idempotency(
            key=key,
            endpoint=endpoint,
            payload=payload,
            operation_fn=billing_operation,
            scope=scope,
            stale_timeout_seconds=0.01,  # Even if stale timeout is tiny, completed record cannot be reclaimed!
        )

    # 1. Error is IDEMPOTENCY_RESPONSE_UNAVAILABLE (NOT a fabricated response)
    assert exc_info.value.code == "IDEMPOTENCY_RESPONSE_UNAVAILABLE"
    # 2. Side effects are NEVER duplicated on retry!
    assert side_effects_run == 1, "Billing or payment side effects must NOT be duplicated on retry!"

