# OrbitLedger security and threat model

OrbitLedger uses defense-in-depth across database constraints, server dependencies, and user interfaces. This document outlines the threats evaluated and the controls implemented to prevent them.

---

## 1. Authentication and identity management

### Threat: credential stuffing, weak passwords, and brute force

1. **Password policy.** Passwords require nine characters, uppercase letters, lowercase letters, and symbols. The frontend checks rules live, and backend Pydantic models validate them before hashing.
2. **Password hashing.** The system hashes passwords using Argon2id (`argon2-cffi`) with memory-hard parameters.
3. **Rate limiting and account lockout.** SlowAPI limits login calls by IP and email to five per minute. Five consecutive failed logins set `locked_until` to fifteen minutes in the future.
4. **Enumeration protection.** The forgot-password endpoint returns `{"message": "If that email exists, a reset link has been dispatched."}` whether the email exists or not.

### Threat: token theft and session hijacking

1. **In-memory access tokens.** Access tokens last fifteen minutes and stay in client application memory. JavaScript storage APIs (`localStorage` and `sessionStorage`) never store them.
2. **HTTP-only refresh cookies.** Refresh tokens travel in cookies marked `HttpOnly`, `SameSite=Strict`, and `Path=/api/auth`. Production configurations require the `Secure` flag.
3. **Token family rotation.** Each refresh exchange consumes the incoming token and issues a new one with the same family identifier. Replaying an expired or revoked token triggers revocation of the entire family.

### Threat: insecure production defaults and misconfiguration

1. **Configuration validator.** During application startup, `app/config.py` runs validation when `ENVIRONMENT` is set to `production`. The check requires `SECRET_KEY` to be at least 32 characters and rejects known defaults (`docker-compose-insecure-secret-key-32chars`, `insecure`, `changeme`). It also requires `SECURE_COOKIES=True` and `COOKIE_SAMESITE=strict`. It prevents `DEMO_MODE=True` unless `ALLOW_PRODUCTION_DEMO_OVERRIDE=True` is explicitly configured. Violations abort process boot with a `ValueError`.
2. **UTC timestamp consistency.** The SQLite driver returns timestamps without timezone information. Helper `ensure_utc` in `app/clock.py` normalizes all stored expiration, lockout, and token timestamps to offset-aware UTC before comparisons.

---

## 2. Authorization and multi-tenancy

### Threat: broken object-level authorization and privilege escalation

1. **Role-based access control.** FastAPI dependencies (`require_roles("admin")`, `require_roles("admin", "staff")`) guard administrative routers.
2. **Customer query scoping.** Customer endpoints filter database queries by the authenticated user customer id. Queries for unowned records return 404 rather than 403, preventing resource enumeration:

```python
sub = db.query(Subscription).filter(
    Subscription.id == sub_id,
    Subscription.customer_id == customer.id,
).first()
if not sub:
    raise NotFoundError("Subscription not found")
```

3. **Automated matrix testing.** The test suite in `tests/authz/test_authz_matrix.py` tests administrative, staff, customer, and unauthenticated requests to verify role boundaries.

---

## 3. Financial precision and idempotency

### Threat: floating-point rounding errors

The application rejects IEEE 754 binary floating-point numbers for money calculations. All prices, discounts, and taxes use Python `Decimal` with `ROUND_HALF_UP` on each line item. The database stores these values as `Numeric(14, 2)`. Property-based tests in `tests/unit/test_pricing_and_tax.py` check these rounding invariants over randomized inputs.

### Threat: double invoicing and concurrent billing runs

1. **Unique constraints.** The `invoices` table enforces `UNIQUE(subscription_id, period_start)`. The database engine prevents inserting two invoices for the same subscription period.
2. **Row locking.** Generating billing rows uses `SELECT ... FOR UPDATE` or `FOR UPDATE SKIP LOCKED` on PostgreSQL to serialize changes.
3. **Optimistic locking.** Mutable tables maintain an integer `version` column. State transitions require matching versions and return 409 if another process modified the row.
4. **Scoped idempotency service.** `POST /api/billing/run` and payment endpoints require an `Idempotency-Key` header with explicit operation scopes (`billing.run`, `payments.record`). The `idempotency_keys` table enforces `UNIQUE(scope, key)`. The service computes a canonical SHA-256 hash of the payload:
   - When a request begins, the service inserts an in-progress record. Sibling concurrent requests with the same key receive 409 (`CONCURRENT_REQUEST_IN_PROGRESS`).
   - If a request repeats with the same key within its scope and an identical payload, the service returns the completed response.
   - If a key is reused across different endpoints or with a changed payload, the service returns 409 (`IDEMPOTENCY_ENDPOINT_MISMATCH` or `IDEMPOTENCY_PAYLOAD_MISMATCH`).
   - If an operation fails, the service cleans up the in-progress reservation so the caller can retry immediately.
   - If an unhandled process termination leaves an in-progress record older than 60 seconds (`stale_timeout_seconds`), subsequent retries safely reclaim and execute the operation.

### Threat: payment replay

Payment requests require an idempotency key. Duplicate attempts return the recorded receipt without processing a second transaction. The payment service locks the invoice row, checks the balance, and rejects amounts exceeding the remaining total.

---

## 4. Audit trail and change tracking

### Threat: untracked mutations and tampering

The append-only `audit_log` table records state changes for subscriptions, invoices, payments, and billing runs. Each entry records:
- `actor_id` (user id or null for worker jobs)
- `action` (name of the transition)
- `entity_type` and `entity_id`
- `before` and `after` JSON snapshots
- `request_id`
- `at` UTC timestamp

The API provides no routes to edit or delete audit log rows.

---

## 5. Network and platform security

1. **Security headers.** Middleware adds standard protection headers to HTTP responses:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `X-XSS-Protection: 1; mode=block`
   - `Referrer-Policy: strict-origin-when-cross-origin`
2. **Parameterized queries.** All database calls use typed SQLAlchemy expressions, preventing SQL injection.
3. **Transactional outbox.** The system writes email messages to the `outbox_messages` table within the same database transaction as the business action. A background worker delivers messages asynchronously to Mailpit, preventing mail server slowdowns from delaying user requests.

---

## 6. Security verification and test coverage

The security and idempotency controls are actively validated across 76 automated backend tests in pytest:
* `tests/authz/test_authz_matrix.py`: Verifies staff cannot perform admin operations, customers cannot access cross-tenant records, and unauthenticated requests receive 401.
* `tests/concurrency/test_billing_idempotency.py`: Verifies atomic lease claims, stale worker timeout recovery, cross-endpoint scope isolation, and identical response caching under simultaneous concurrent requests.
* `tests/concurrency/test_payment_and_discount_concurrency.py`: Verifies atomic conditional balance updates preventing concurrent overpayments across threads, and atomic coupon limit decrement.
* `tests/unit/test_auth_and_security.py`: Verifies production configuration enforcement (rejecting placeholder keys, insecure cookies, lax SameSite, and unauthenticated demo mode), refresh cookie HttpOnly attributes, password complexity rules, lockout after 5 failed attempts, enumeration resistance, and token rotation family revocation.

### Dependency vulnerability audits

Regular automated audits are executed in CI and verified locally:

1. **Python backend dependencies (`pip-audit`):**
   - Executed against `requirements.txt`.
   - Result: **0 known vulnerabilities** found.

2. **Frontend dependencies (`npm audit --omit=dev`):**
   - Executed against production dependencies.
   - Known upstream transitive advisories in dependencies that cannot be upgraded without breaking framework compatibility:
     - **`esbuild` / `vite` / `vitest` / `tinypool`:** Local dev-server and test runner tooling bundled in `dependencies`. These are build-time only tools; production runtime serves precompiled static assets through Nginx with zero Node.js execution. Upgrading to Vite 8 / Vitest 4 requires breaking architectural changes across plugins.
     - **`minimatch`:** Transitive dependency of `@typescript-eslint`. A developer linting dependency with zero runtime exposure in client builds.
     - **`react-router-dom` (GHSA-wrjc-x8rr-h8h6 / GHSA-337j-9hxr-rhxg):** Pertains to server-side rendering (SSR) hydration (`deserializeErrors`) and open redirects via backslash in dynamic navigation. OrbitLedger is a pure client-side SPA with no SSR hydration, and all navigation targets are hardcoded application paths. Upgrading to React Router v7 involves breaking API changes across the component tree.
     - **`zod` (GHSA-mrhx-c7xc-m3w5):** Pertains to memory exhaustion when validating deeply nested recursive structures. OrbitLedger uses Zod schemas exclusively for flat, constrained form fields with explicit maximum lengths and regex bounds. Upgrading to Zod v4 is a major breaking change.

### Known limitations in security posture

1. **TLS termination**: Docker Compose defaults to HTTP on port 80 for self-contained local testing; production deployment requires a TLS-terminating reverse proxy (e.g. Traefik, Nginx, or AWS ALB) with HSTS headers.
2. **Rate limiting storage**: Rate limiting uses SlowAPI's in-memory backend for local nodes; multi-replica horizontal clustering requires configuring SlowAPI with a shared Redis instance.
3. **Demo mode guard**: When `DEMO_MODE=true` is set, clock advancement is accessible to users with the `admin` role only. Production deployments strictly disable this endpoint unless `ALLOW_PRODUCTION_DEMO_OVERRIDE=true` is explicitly provided.
