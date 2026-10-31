# Judge questions and answers

Technical and architectural questions for the OrbitLedger evaluation.

---

### How do you prevent duplicate billing during network retries or concurrent cron jobs?

OrbitLedger uses three controls:

1. **Unique constraints.** The `invoices` table enforces `UNIQUE(subscription_id, period_start)`. The database engine rejects duplicate invoices for the same cycle.
2. **Row locking.** On PostgreSQL, the billing query runs with `SELECT ... FOR UPDATE SKIP LOCKED`. A worker locks eligible subscriptions before processing, so parallel workers skip them. On SQLite, the operation runs within a serialized transaction.
3. **Scoped idempotency keys.** Operations require an `Idempotency-Key` header scoped to the logical domain (for example, `billing.run` and `payments.record`). The `idempotency_keys` table enforces `UNIQUE(scope, key)`. The service hashes the JSON payload with canonical SHA-256 and records an `in_progress` reservation. Repeated requests with the same key and payload return the cached response. Replaying the key with changed parameters or against a different scope returns HTTP 409. If an unhandled crash leaves an in-progress record older than 60 seconds, subsequent requests reclaim the key cleanly.

---

### Why use Python Decimal and Numeric(14,2) instead of floating-point numbers?

Binary floating-point arithmetic introduces precision errors in base-10 math (for example, `0.1 + 0.2 = 0.30000000000000004`). In financial accounting, fractional cent errors accumulate across invoice line items.

OrbitLedger handles money using Python's `Decimal` class with `ROUND_HALF_UP` on each line item. The database stores these values as `Numeric(14,2)`. Tests in `tests/unit/test_pricing_and_tax.py` verify these invariants with randomized property-based tests.

---

### What happens when a subscription starts on January 31st? Does the next invoice drift to February 28th and then March 28th?

Date addition without an anchor causes drift when months vary in length. Adding one month to February 28 produces March 28 instead of March 31.

OrbitLedger stores a `billing_anchor` on the subscription record set to the original start date (January 31). Each period calculation uses:
`period_start = billing_anchor + relativedelta(months=periods_billed)`

Using `dateutil.relativedelta`, January 31 plus one month resolves to February 28, and January 31 plus two months resolves to March 31. The test `test_month_end_anchor_relativedelta_drift_free` in `tests/concurrency/test_billing_idempotency.py` checks this calculation.

---

### How does the discount engine handle overlapping promotions?

Decision record D-004 defines discount evaluation:

1. **Two scopes.** Line-level discounts apply to specific goods. Subscription-level discounts apply to the subtotal.
2. **Best single rule.** For each line item, the engine checks all eligible product discounts and applies the single discount with the largest deduction.
3. **Non-compounding order discount.** The engine evaluates subscription discounts against the remaining post-line subtotal and applies the best single discount.
4. **Bounds.** Line discounts cannot exceed the line item base price, and total discounts cannot exceed the pre-discount total.

---

### How do you prevent broken object-level authorization in the customer portal?

The `get_customer_scope` dependency in `app/deps.py` reads the customer id from the verified JWT.

Portal endpoints filter queries by `customer_id == customer.id`. If a user requests a record belonging to another customer, the server returns 404 rather than 403. This prevents attackers from testing which resource IDs exist.

---

### How does the architecture scale to larger subscription volumes?

1. **Stateless API.** FastAPI nodes hold no session state in process memory. The API scales horizontally behind an HTTP load balancer.
2. **Worker partitioning.** Scheduled billing queries use `FOR UPDATE SKIP LOCKED`. Multiple worker processes consume non-overlapping partitions of due subscriptions concurrently.
3. **Targeted indexes.** Compound indexes match the primary search and batch query filters:
   - `subscriptions(status, next_invoice_date)`
   - `invoices(subscription_id, period_start)` (unique)
   - `invoices(status, due_date)` for overdue balances

---

### Why use the transactional outbox pattern for emails?

Sending emails directly inside an HTTP request or database transaction has two failure modes:
1. If the SMTP server responds slowly or fails, the user request blocks or fails even when the database write succeeded.
2. If the transaction rolls back after the SMTP call succeeds, the customer receives an email for a transaction that does not exist.

With the transactional outbox pattern, the API writes email notifications to the `outbox_messages` table within the same transaction as the business event. A background worker process polls pending messages and delivers them to the mail server with retries.

---

### How does token refresh defend against token theft?

1. The access token lasts fifteen minutes and lives only in browser memory.
2. The refresh token sits in an `HttpOnly`, `SameSite=Strict` cookie with the `Secure` flag in production.
3. Each refresh exchange invalidates the incoming token and issues a new one with the same family identifier.
4. If a previously consumed or revoked token is reused, the service revokes all active tokens in that family and forces re-authentication.

---

### How do you enforce usage limits on coupons under concurrent requests?

OrbitLedger avoids read-then-write races by using an atomic SQL update:

```sql
UPDATE discount_rules
SET used_count = used_count + 1
WHERE id = :id AND (usage_limit IS NULL OR used_count < usage_limit);
```

If the update affects zero rows, the limit was exhausted and the service rejects the coupon application for that request.

---

### Why support SQLite alongside PostgreSQL?

The repository supports running and testing without requiring Docker or a local PostgreSQL installation.

All queries use portable SQLAlchemy 2.0 ORM expressions. PostgreSQL-specific features (`SKIP LOCKED` and advisory locks) sit behind dialect checks. OrbitLedger runs on both `sqlite:///brightloop.db` and PostgreSQL with identical business logic.

---

### How are test databases isolated so running pytest never mutates `brightloop.db`?

In `backend/conftest.py`, pytest initializes an isolated temporary SQLite database using `tempfile.NamedTemporaryFile` when `DATABASE_URL` is unset or points to the development database. It clears the settings cache, binds `app.db.engine` and `app.db.SessionLocal` to the isolated test database, and seeds it once for the test session. On session teardown, the temporary engine is disposed and the temp file is deleted. The physical `brightloop.db` file remains completely untouched.

---

### What test coverage and benchmark metrics were achieved?

1. **Test Count**: 60 backend pytest tests and 16 frontend Vitest tests (76 automated tests in total, 100% passing).
2. **Service Layer Coverage**: 83% overall across `app/services/`:
   - `services/catalog.py`: 98%
   - `services/tax.py`: 97%
   - `services/payment.py`: 89%
   - `services/subscription.py`: 88%
   - `services/idempotency.py`: 85%
   - `services/numbering.py`: 83%
   - `services/auth.py`: 81%
3. **API Route Synchronization**: 60 out of 60 frontend API calls match valid operations in the OpenAPI schema (`scripts/verify_api_routes.py`).
4. **Performance**: In 50-iteration benchmarks, `GET /api/reports/summary` responds in 7.85 ms p95 (budget: 800 ms), and standard reads respond in under 55 ms p95.

---

### What are the known limitations of the current implementation?

1. **Local SQLite concurrency**: SQLite uses serialized transactions and file-level locks. True non-blocking queue consumers using `SKIP LOCKED` require PostgreSQL 16 (configured in `docker-compose.yml`).
2. **Payment processor integration**: The payment recording subsystem handles real accounting states and balance deductions (UPI, Card, Bank Transfer, Cash, Cheque) without simulated third-party gateway webhooks (e.g. Stripe, Razorpay).
3. **SMTP delivery**: Transactional outbox messages are dispatched to local Mailpit (`http://localhost:8025`) rather than external commercial relays with DKIM/SPF.
4. **Frontend rendering**: Single-page application using React 18, React Hook Form, and Zod with route-level code splitting (`React.lazy`), but without server-side rendering (SSR).
