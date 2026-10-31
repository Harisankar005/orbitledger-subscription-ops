# Brightloop System Architecture

## 1. High-Level Topology

```mermaid
flowchart TD
    subgraph Client["Client Tier (Browser)"]
        SPA["React 18 SPA (Vite + TS + Tailwind)"]
    end

    subgraph ReverseProxy["Web Server / Reverse Proxy"]
        Nginx["Nginx (Production) / Vite Proxy (Dev)"]
    end

    subgraph Backend["Application Tier"]
        API["FastAPI API (Port 8000)"]
        Worker["Background Worker (APScheduler)"]
        SSE["SSE Event Broadcaster (/api/events)"]
    end

    subgraph Data["Persistence & Services"]
        DB[("PostgreSQL 16 (or SQLite Fallback)")]
        Mailpit["Mailpit Local SMTP (:1025 / UI :8025)"]
    end

    SPA -->|HTTP REST / SSE| Nginx
    Nginx -->|Reverse Proxy /api| API
    API -->|Read / Write / Transactions| DB
    API -->|Push Events| SSE
    Worker -->|Lock / Poll Due Subs / Dunning| DB
    Worker -->|Send Outbox Emails| Mailpit
```

## 2. Layered Software Architecture

Brightloop strictly enforces a 3-tier backend design pattern:

1. **Routers (`app/routers/*`)**:
   - HTTP transport only: parameter deserialization, query parsing, status code selection, response serialization.
   - Zero business rules or transaction management.
2. **Services (`app/services/*`)**:
   - The authoritative core of the platform.
   - Manages database transaction boundaries (`session.commit()` / `session.rollback()`).
   - Implements invariants: pricing math with `Decimal`, state machine transitions, discount eligibility, tax resolution order, billing runs, and audit trail emission.
3. **Models & Repositories (`app/models/*`, `app/repositories/*`)**:
   - Declarative SQLAlchemy 2.0 mapped models.
   - Database constraints (CHECK, UNIQUE, Foreign Keys, Indexes).

## 3. Subscription Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> draft: Create subscription or from template
    draft --> quotation: Validate min_quantity & availability
    quotation --> confirmed: Confirm before validity expires
    quotation --> draft: Revise quotation
    confirmed --> active: Activate manually or on start_date
    active --> paused: Pause (if plan.allow_pause)
    paused --> active: Resume
    active --> closed: Close early (if plan.allow_early_close)
    active --> closed: Auto-close on expiry (if plan.auto_close_on_end)
    closed --> [*]
    closed --> draft: Renew (if plan.allow_renew)
```

## 4. Billing Engine & Idempotency Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as APScheduler / Admin
    participant Engine as Billing Engine (app.services.billing)
    participant Lock as PostgreSQL Advisory Lock / Mutex
    participant DB as Database

    Scheduler->>Engine: Run Billing(as_of_date, Idempotency-Key)
    Engine->>Lock: Acquire advisory lock (prevent parallel workers)
    Engine->>DB: Query due subscriptions (status=active, next_invoice_date <= as_of_date)
    loop For each due subscription (own transaction)
        loop While next_invoice_date <= as_of_date (catch up missed periods)
            Engine->>Engine: Compute period_start = anchor + n*period (relativedelta)
            Engine->>Engine: Resolve plan fee + product lines + variant extra prices
            Engine->>Engine: Resolve taxes (Line -> Product Default -> Priority Tax Rule)
            Engine->>Engine: Resolve best single product discount & invoice discount
            Engine->>DB: Atomically increment discount used_count (conditional update)
            Engine->>DB: Issue next invoice number from number_counters (FOR UPDATE)
            Engine->>DB: INSERT INTO invoices (status=draft)
            Note over DB: Guarded by UNIQUE(subscription_id, period_start)
            Engine->>DB: UPDATE subscription SET periods_billed += 1, next_invoice_date
        end
    end
    Engine->>DB: Commit transaction & Record Audit Log
    Engine->>Scheduler: Return {created, skipped_already_billed, skipped_not_due, failed, duration_ms}
```

## 5. Security & Authentication Architecture

- **Password Security**: Argon2id hashing algorithm with standard parameters. Password policy requiring minimum 9 characters, uppercase, lowercase, and special characters.
- **Session Architecture**:
  - Stateless JWT access tokens (15-minute validity) stored strictly in client memory.
  - Refresh tokens stored in encrypted `httpOnly`, `Secure`, `SameSite=Strict` cookies.
  - **Token Family Rotation**: Every refresh generates a new token in the token family. Attempted reuse of a previous token triggers instant revocation of the entire family.
- **Role-Based Access Control (RBAC)**:
  - Three distinct roles: `admin`, `staff`, `customer`.
  - Server-enforced dependency injection via `require_roles()`.
  - Ownership scoping: customer queries filter strictly by `customer.user_id == current_user.id`; unauthorized access returns `404 Not Found` to prevent IDOR scanning.
