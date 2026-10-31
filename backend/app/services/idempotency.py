import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Tuple

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from app.clock import ensure_utc
from app.db import SessionLocal
from app.errors import ConflictError, ValidationError
from app.models.platform import IdempotencyKey

IN_PROGRESS_MARKER = "__IN_PROGRESS__"
CACHE_UNAVAILABLE_MARKER = "__CACHE_UNAVAILABLE__"
DEFAULT_STALE_TIMEOUT_SECONDS = 60.0


def compute_canonical_hash(payload: Any) -> str:
    """Compute deterministic SHA-256 hash of a payload dictionary or Pydantic model."""
    if hasattr(payload, "model_dump"):
        data = payload.model_dump()
    elif isinstance(payload, dict):
        data = payload
    else:
        data = {"raw": str(payload)}

    canonical_json = json.dumps(data, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def execute_with_idempotency(
    key: Optional[str],
    endpoint: str,
    payload: Any,
    operation_fn: Callable[[], Any],
    scope: Optional[str] = None,
    max_wait_seconds: float = 5.0,
    stale_timeout_seconds: float = DEFAULT_STALE_TIMEOUT_SECONDS,
) -> Tuple[Any, bool]:
    """Execute an operation with transaction-safe, race-proof idempotency guarantees.

    Guarantees:
    1. Requires a non-empty Idempotency-Key.
    2. Scoped to a distinct business operation or endpoint (scope + key unique constraint).
    3. Hashes request payload canonically (SHA-256).
    4. Returns cached result for identical key + payload within scope.
    5. Rejects key reuse with different payload (409 Conflict).
    6. Rejects key reuse across different endpoints within same scope (409 Conflict).
    7. Atomically claims in-progress reservation, serialized via DB UNIQUE(scope, key).
    8. In-progress records cannot be mistaken for completed responses.
    9. Sibling concurrent requests wait up to max_wait_seconds for completed response.
    10. Stale in-progress records (> stale_timeout_seconds) are safely claimed via atomic compare-and-swap so only one worker executes.
    11. Deletes in-progress marker on failure so retries succeed cleanly.
    12. Guarantees at-most-once execution of the operation block; end-to-end exactly-once semantics require transactional or independently idempotent business logic.

    Returns:
        Tuple of (result, was_cached: bool)
    """
    if not key or not key.strip():
        raise ValidationError(
            "Idempotency-Key header is required for this operation",
            fields={"Idempotency-Key": "Header missing or empty"},
        )

    clean_key = key.strip()
    clean_scope = (scope or endpoint.split("?")[0]).strip()
    req_hash = compute_canonical_hash(payload)
    start_time = time.time()

    while True:
        with SessionLocal() as db:
            existing = (
                db.query(IdempotencyKey)
                .filter(IdempotencyKey.scope == clean_scope, IdempotencyKey.key == clean_key)
                .first()
            )

            if existing:
                # 1. Validate endpoint within scope
                if existing.endpoint != endpoint:
                    raise ConflictError(
                        f"Idempotency key was previously used for a different endpoint: {existing.endpoint}",
                        code="IDEMPOTENCY_ENDPOINT_MISMATCH",
                        fields={"Idempotency-Key": "Key reused across different endpoints"},
                    )

                # 2. Validate payload match
                if existing.request_hash != req_hash:
                    raise ConflictError(
                        "Idempotency key was previously used with a different request payload",
                        code="IDEMPOTENCY_PAYLOAD_MISMATCH",
                        fields={"Idempotency-Key": "Payload mismatch for key"},
                    )

                # 3. If completed, return cached response
                if existing.status == "completed":
                    if existing.response_json and existing.response_json not in (IN_PROGRESS_MARKER, CACHE_UNAVAILABLE_MARKER):
                        try:
                            cached_data = json.loads(existing.response_json)
                            return cached_data, True
                        except Exception:
                            pass
                    # If response_json is None, CACHE_UNAVAILABLE_MARKER, corrupted, or unavailable:
                    # Side effects already ran, so we must NEVER re-execute them,
                    # and we must NEVER fabricate a fake generic completed response.
                    raise ConflictError(
                        "The operation was already completed successfully, but the cached response payload is unavailable. Business side effects will not be duplicated.",
                        code="IDEMPOTENCY_RESPONSE_UNAVAILABLE",
                        fields={"Idempotency-Key": "Operation already completed; cached response unavailable"},
                    )

                # 4. In-progress check: check for stale abandoned execution (crash recovery strategy)
                updated_utc = ensure_utc(existing.updated_at) or ensure_utc(existing.created_at) or datetime.now(timezone.utc)
                age_seconds = (datetime.now(timezone.utc) - updated_utc).total_seconds()
                if age_seconds > stale_timeout_seconds:
                    # Atomic conditional lease claim using compare-and-swap on (scope, key, status, updated_at).
                    # Only one worker can match updated_at == existing.updated_at.
                    now = datetime.now(timezone.utc)
                    stmt = (
                        update(IdempotencyKey)
                        .where(
                            IdempotencyKey.scope == clean_scope,
                            IdempotencyKey.key == clean_key,
                            IdempotencyKey.status == "in_progress",
                            IdempotencyKey.updated_at == existing.updated_at,
                        )
                        .values(
                            updated_at=now,
                            response_json=IN_PROGRESS_MARKER,
                        )
                    )
                    res = db.execute(stmt)
                    db.commit()
                    rowcount = getattr(res, "rowcount", 0)
                    if rowcount == 1:
                        # Exactly one worker wins the atomic lease claim!
                        break
                    else:
                        # Another worker claimed the lease or completed the operation.
                        # Do NOT execute operation_fn. Loop back and re-inspect.
                        time.sleep(0.05)
                        continue

                # Sibling execution is active; wait for completion
                if time.time() - start_time > max_wait_seconds:
                    raise ConflictError(
                        "A request with this idempotency key is currently in progress. Please retry shortly.",
                        code="IDEMPOTENCY_IN_PROGRESS",
                        fields={"Idempotency-Key": "Concurrent operation in progress"},
                    )

            else:
                # Attempt to atomically reserve (scope, key) with in-progress status
                now = datetime.now(timezone.utc)
                in_progress = IdempotencyKey(
                    scope=clean_scope,
                    key=clean_key,
                    endpoint=endpoint,
                    request_hash=req_hash,
                    response_json=IN_PROGRESS_MARKER,
                    status="in_progress",
                    created_at=now,
                    updated_at=now,
                )
                db.add(in_progress)
                try:
                    db.commit()
                    # Successfully claimed reservation; proceed to execute
                    break
                except IntegrityError:
                    db.rollback()
                    # Concurrent request inserted first; loop to inspect existing
                    continue

        time.sleep(0.05)

    # Execute the underlying operation
    try:
        result = operation_fn()
    except Exception as exc:
        # On failure: clean up in-progress reservation so retries can proceed cleanly
        try:
            with SessionLocal() as db:
                entry = (
                    db.query(IdempotencyKey)
                    .filter(
                        IdempotencyKey.scope == clean_scope,
                        IdempotencyKey.key == clean_key,
                        IdempotencyKey.status == "in_progress",
                    )
                    .first()
                )
                if entry:
                    db.delete(entry)
                    db.commit()
        except Exception:
            pass
        raise exc

    # Operation succeeded! Persist success response and mark as completed.
    payload_str: Optional[str] = None
    try:
        if hasattr(result, "model_dump"):
            serialized = result.model_dump()
        elif isinstance(result, dict):
            serialized = result
        elif isinstance(result, (list, tuple)):
            serialized = [item.model_dump() if hasattr(item, "model_dump") else item for item in result]
        elif result is None:
            serialized = None
        else:
            serialized = {"result": result}
        payload_str = json.dumps(serialized, default=str)
    except Exception:
        # Never fabricate a generic fake response payload
        payload_str = CACHE_UNAVAILABLE_MARKER

    if payload_str is None:
        payload_str = CACHE_UNAVAILABLE_MARKER

    persisted = False
    for _ in range(3):
        try:
            with SessionLocal() as db:
                entry = (
                    db.query(IdempotencyKey)
                    .filter(IdempotencyKey.scope == clean_scope, IdempotencyKey.key == clean_key)
                    .first()
                )
                if entry:
                    entry.response_json = payload_str
                    entry.status = "completed"
                    entry.updated_at = datetime.now(timezone.utc)
                    db.commit()
                    persisted = True
                    break
        except Exception:
            time.sleep(0.05)

    if not persisted:
        # If persisting the response payload failed, the operation side effects have
        # ALREADY completed successfully! Mark as completed with response_json=CACHE_UNAVAILABLE_MARKER so
        # stale lease claims cannot re-execute operation_fn() and duplicate billing or payments,
        # while never fabricating a fake completed response payload.
        try:
            with SessionLocal() as fallback_db:
                fallback_db.query(IdempotencyKey).filter(
                    IdempotencyKey.scope == clean_scope,
                    IdempotencyKey.key == clean_key,
                ).update({
                    "response_json": CACHE_UNAVAILABLE_MARKER,
                    "status": "completed",
                    "updated_at": datetime.now(timezone.utc),
                })
                fallback_db.commit()
        except Exception:
            pass

    return result, False
