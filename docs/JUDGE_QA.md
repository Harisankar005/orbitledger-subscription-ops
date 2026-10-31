# Judge Q&A Defense Cheat Sheet

This document equips the team with concise, authoritative answers to deep engineering and business logic questions judges may ask during evaluation.

---

### Q1: "How do you guarantee that a subscription is never double-billed if two cron jobs trigger simultaneously or if a network retry occurs?"
**Answer**:
> "We implement a 3-layer defense against double billing:
> 1. **Database Constraint (The Ultimate Guard)**: We enforce a compound unique constraint on the `invoices` table: `UNIQUE(subscription_id, period_start)`. At the database engine level, two concurrent transactions attempting to insert an invoice for the same subscription and period will result in a unique violation.
> 2. **Serialized Row Locking**: On PostgreSQL, our billing query runs with `SELECT ... FOR UPDATE SKIP LOCKED` (and serializes via row locks on SQLite). A worker locks eligible subscriptions before processing, ensuring sibling workers skip records currently under active generation.
> 3. **Idempotency Keys & Payload Verification**: API endpoints like `POST /api/billing/run` and `POST /api/payments` require an `Idempotency-Key` header with canonical SHA-256 payload hashing (`execute_with_idempotency`). Requests with duplicate keys return the cached result payload without re-executing transactions. Replaying a key with modified payload fails with `409 Conflict`, and concurrent duplicate requests are blocked via atomic in-progress reservations."

---

### Q2: "Why did you use Python `Decimal` and `Numeric(14,2)` instead of standard IEEE 754 floats?"
**Answer**:
> "Binary floating-point arithmetic is inherently lossy for base-10 currency math (e.g., in JavaScript or Python `0.1 + 0.2 = 0.30000000000000004`). In financial accounting, fractional cent creep across thousands of billing lines corrupts tax calculations and ledger reconciliations.
>
> In Brightloop, money is strictly handled via Python's `Decimal` class with `ROUND_HALF_UP` executed per line item, and persisted in SQL as `Numeric(14,2)`. We verified this invariant with property-based testing (`hypothesis`) across arbitrary price and quantity permutations in `tests/unit/test_pricing_and_tax.py`."

---

### Q3: "What happens when a subscription starts on January 31st? Does the next invoice drift to February 28th and then March 28th?"
**Answer**:
> "This is a classic billing engine flaw known as 'anchor drift'. If you simply add 30 days or increment months from the previous invoice date (`Feb 28 + 1 month = Mar 28`), your billing anchor slowly creeps forward.
>
> In Brightloop, we store a permanent `billing_anchor` on the subscription record (the original `start_date`, e.g. Jan 31). Every period is calculated as:
> `period_start = billing_anchor + relativedelta(months=periods_billed)`
>
> Using `dateutil.relativedelta`, Jan 31 + 1 month becomes Feb 28, but Jan 31 + 2 months snaps back to March 31. We wrote an explicit test for this exact scenario in `tests/concurrency/test_billing_idempotency.py`."

---

### Q4: "How does your discount engine prevent margin collapse when multiple coupons and promotions overlap?"
**Answer**:
> "We established Architectural Decision **D-004** for discount stacking:
> 1. **Two distinct scopes**: Line-level discounts (`product` scope) apply to specific goods, while order-level discounts (`subscription` scope) apply to the overall order.
> 2. **Best-Single Rule**: For any line item, the engine evaluates all active eligible product promotions and picks the single discount that yields the highest deduction.
> 3. **Non-compounding Order Discount**: The engine then evaluates subscription-level discounts against the remaining post-line subtotal and applies the best single order coupon.
> 4. **Bound Invariants**: No line can have a discount exceeding its base price, and no invoice can discount below ₹0.00."

---

### Q5: "How did you prevent Broken Object-Level Authorization (IDOR) in the customer portal?"
**Answer**:
> "We do not rely on frontend path checks. In `app/deps.py`, the `get_customer_scope` dependency extracts the authenticated user from the verified JWT in the current session.
>
> Every portal endpoint automatically scopes all SQL queries by `customer_id == customer.id`. Crucially, if a user attempts to fetch or manipulate a subscription or invoice ID that belongs to another customer, the server responds with **`404 Not Found`** rather than `403 Forbidden`. This completely prevents malicious actors from enumerating resource IDs across the platform."

---

### Q6: "How does your system scale if Brightloop grows to 500,000 active subscriptions?"
**Answer**:
> "1. **Stateless API tier**: The FastAPI application holds zero session state in local process memory (JWTs are decoded with symmetric keys, DB connection pool is managed by SQLAlchemy). It scales horizontally across multiple containers behind Nginx or an AWS ALB.
> 2. **Worker Partitioning**: Nightly billing runs are paginated and chunked into batches using `FOR UPDATE SKIP LOCKED`. Multiple worker processes can run concurrently on different nodes without colliding or duplicating work.
> 3. **Covering Indexes**: We created compound indexes specifically aligned with high-frequency billing queries:
>    - `subscriptions(status, next_invoice_date)`
>    - `invoices(subscription_id, period_start)` (Unique)
>    - `partial index on invoices(due_date) WHERE status='confirmed'` for instant overdue aging."

---

### Q7: "Why did you implement the Transactional Outbox Pattern for email delivery?"
**Answer**:
> "Sending emails synchronously within an HTTP request or DB transaction is an anti-pattern:
> 1. If the SMTP server is slow or down, the user's API call hangs or fails, even though the database record was valid.
> 2. If the DB transaction rolls back after the SMTP call succeeded, a phantom invoice notification is delivered to the customer for an invoice that doesn't exist.
>
> With the **Transactional Outbox Pattern**, notification emails are written as rows into the `outbox_messages` table within the exact same database transaction as the business event. Our background worker process asynchronously dequeues pending messages and delivers them to Mailpit with automated retry logic and exponential backoff."

---

### Q8: "How does your token refresh mechanism protect against token theft and replay attacks?"
**Answer**:
> "We implement **Refresh Token Rotation with Token Families**:
> 1. The short-lived access JWT (15 min) lives only in browser memory.
> 2. The refresh token is delivered in a `SameSite=Strict`, `httpOnly`, `Secure` cookie.
> 3. Every time a refresh token is used, it is revoked and replaced with a new token assigned to the same `family_id`.
> 4. If an attacker intercepts and replays an already-revoked refresh token, our security middleware detects reuse and **immediately invalidates the entire family**, locking out the attacker and forcing the legitimate user to re-authenticate."

---

### Q9: "How do you handle coupon codes with a max usage limit under high concurrency?"
**Answer**:
> "We avoid the classic 'read-then-update' race condition where two concurrent checkouts read `used_count = 99` on a limit of 100 and both proceed.
>
> Instead, Brightloop executes an atomic conditional SQL update:
> ```sql
> UPDATE discount_rules
> SET used_count = used_count + 1
> WHERE id = :id AND (usage_limit IS NULL OR used_count < usage_limit)
> ```
> If `rowcount == 0`, the limit was exhausted mid-flight, and the engine gracefully rejects the discount application for that transaction."

---

### Q10: "Why support SQLite alongside PostgreSQL?"
**Answer**:
> "We wanted an **offline-first, zero-barrier-to-entry developer experience**. A judge or hackathon evaluator reviewing our repository shouldn't be blocked if they do not have a Docker daemon or local PostgreSQL cluster configured.
>
> We wrote 100% portable SQLAlchemy 2.0 ORM expressions, while isolating Postgres-specific optimizations (`SKIP LOCKED`, advisory locks) behind clean dialect guards. Brightloop boots and runs flawlessly with both `sqlite:///brightloop.db` and `postgresql://postgres:postgres@localhost:5432/brightloop` without code changes."
