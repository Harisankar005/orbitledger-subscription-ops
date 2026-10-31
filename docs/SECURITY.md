# Brightloop Security & Threat Model

Brightloop is engineered with defense-in-depth principles across the entire application stack, from database constraints to frontend UI validations. This document outlines our threat model, attack vectors considered, and the architectural controls implemented to mitigate them.

---

## 1. Authentication & Identity Management

### Threat: Credential Stuffing, Weak Passwords & Brute Force
- **Mitigation 1 (Password Policy)**: Minimum 9 characters (strictly `> 8`), requiring at least one uppercase letter, one lowercase letter, and one non-alphanumeric special character. Enforced both client-side via a live reactive checklist and server-side via regex-backed Pydantic validators.
- **Mitigation 2 (Argon2id Hashing)**: Passwords are encrypted using the memory-hard **Argon2id** password hashing algorithm (via `argon2-cffi`), which is resilient against GPU and ASIC based offline brute force attacks.
- **Mitigation 3 (Rate Limiting & Account Lockout)**: Login attempts are throttled by IP + email combinations using SlowAPI (5 attempts/min). Consecutive failures increment `failed_logins`; reaching 5 consecutive failures triggers an automatic 15-minute lockout (`locked_until`).
- **Mitigation 4 (Enumeration Prevention)**: The forgot-password endpoint returns an identical generic message (`{"message": "If that email exists, a reset link has been dispatched."}`) regardless of whether the email is present in the database, preventing user enumeration.

### Threat: Token Theft, XSS Exfiltration & Session Hijacking
- **Mitigation 1 (In-Memory Access Tokens)**: Short-lived access JWTs (15 minutes) are kept exclusively in JavaScript memory; they are never persisted in `localStorage` or `sessionStorage`, rendering them immune to extraction via XSS.
- **Mitigation 2 (HttpOnly Refresh Cookies)**: Refresh tokens are delivered via an `httpOnly`, `SameSite=Strict`, `Path=/api/auth` cookie, preventing client-side script inspection.
- **Mitigation 3 (Token Family Rotation & Reuse Detection)**: Every refresh request invalidates the presenting refresh token and issues a new one within the same family ID. If a previously consumed or revoked token is replayed, the system detects a compromise and **immediately revokes all active tokens in that entire family**, requiring re-authentication.

---

## 2. Authorization & Multi-Tenancy (IDOR / BOLA Prevention)

### Threat: Broken Object-Level Authorization (IDOR) & Privilege Escalation
- **Role-Based Access Control (RBAC)**: Centralized FastAPI dependencies (`require_roles("admin")`, `require_roles("admin", "staff")`) guard every operation router.
- **Customer Scoping & 404 Obfuscation**: Customers can never view or mutate another subscriber's records. When a customer queries a subscription, invoice, or profile:
  ```python
  sub = db.query(Subscription).filter(
      Subscription.id == sub_id,
      Subscription.customer_id == customer.id
  ).first()
  if not sub:
      raise NotFoundError("Subscription not found") # Returns 404, not 403
  ```
  Returning `404 Not Found` rather than `403 Forbidden` completely closes entity enumeration vulnerabilities.
- **Automated Matrix Verification**: Our automated test suite includes `tests/authz/test_authz_matrix.py`, which systematically exercises endpoints across `admin`, `staff`, `customer`, and `unauthenticated` principals, verifying that unauthorized calls are strictly denied.

---

## 3. Financial Integrity & Precision

### Threat: Floating Point Rounding Inaccuracies
- **Mitigation**: Binary floating-point arithmetic (e.g. `0.1 + 0.2 = 0.30000000000000004`) is completely prohibited across the codebase.
- All monetary amounts, unit prices, discounts, and taxes are handled strictly using Python's `Decimal` type with `ROUND_HALF_UP` per line item, and stored as `Numeric(14, 2)` in PostgreSQL/SQLite.
- Verified with property-based testing (`hypothesis`) over thousands of generated pricing values.

### Threat: Double Invoicing & Race Conditions
- **Database Unique Constraint**: `invoices` contains a hard compound unique constraint `UNIQUE(subscription_id, period_start)`. Even under concurrent billing process execution, the database guarantees that a subscription can never be billed twice for the same cycle.
- **Row Locking**: During subscription transitions and billing generation, rows are locked (`SELECT ... FOR UPDATE` or `FOR UPDATE SKIP LOCKED` on PostgreSQL) to ensure serialized state changes.
- **Optimistic Concurrency Control**: All mutable aggregates (`subscriptions`, `invoices`) maintain a `version` column. State transitions require matching `expected_version`, failing with `409 Conflict` if another operator made a concurrent edit.

### Threat: Payment Replay & Race Conditions
- **Idempotency Keys**: `POST /api/payments` accepts a unique `Idempotency-Key` header. Duplicate attempts with the same key immediately return the cached receipt without double-crediting.
- Payments lock the invoice row with `with_for_update()`, check the outstanding balance, and reject payments exceeding the remaining unpaid balance.

---

## 4. Audit Trail & Non-Repudiation

### Threat: Insider Tampering & Untracked Mutations
- **Append-Only Audit Ledger**: The `audit_log` table records every critical business mutation (`subscription.transition`, `invoice.confirmed`, `invoice.cancelled`, `payment.recorded`, `billing.run`).
- Each entry captures:
  - `actor_id` (User ID or null for system background worker)
  - `action` (e.g. `subscription.transition`)
  - `entity_type` & `entity_id`
  - `before` state JSON snapshot
  - `after` state JSON snapshot
  - `request_id` (correlated with HTTP request logs)
  - `at` UTC timestamp
- **Zero Mutation Endpoints**: There are no update or delete routes for the audit log table. It is strictly append-only.

---

## 5. Network & Platform Security

- **Security Headers**: Standard OWASP recommended headers injected into all HTTP responses via custom Starlette middleware:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- **Parameterized SQL Queries**: 100% of queries use SQLAlchemy typed ORM / Core expressions; raw string interpolation in SQL is strictly prohibited, neutralizing SQL injection.
- **Outbox Email Isolation**: Notification emails are saved as database rows in `outbox_messages` in the same transaction as the business event. The dispatcher delivers them asynchronously to Mailpit, ensuring slow or down mail servers never impact API transaction latency or leak SMTP credentials.
