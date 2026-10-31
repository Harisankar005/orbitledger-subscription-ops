# Brightloop system architecture

## 1. High-level topology

```mermaid
flowchart TD
    subgraph Client [Client tier]
        SPA["React 18 single-page app"]
    end

    subgraph ReverseProxy [Web server]
        Nginx["Nginx or Vite proxy"]
    end

    subgraph Backend [Application tier]
        API["FastAPI API"]
        Worker["APScheduler worker"]
        SSE["SSE event broadcaster"]
    end

    subgraph Data [Persistence and services]
        DB[("PostgreSQL 16 or SQLite")]
        Mailpit["Mailpit local SMTP"]
    end

    SPA --> Nginx
    Nginx --> API
    API --> DB
    API --> SSE
    Worker --> DB
    Worker --> Mailpit
```

## 2. Layered software architecture

1. **Routers.** `app/routers/` handles HTTP transport: parameter deserialization, query parsing, status code selection, and response serialization. Routers contain no business rules or transaction management.
2. **Services.** `app/services/` executes business rules and manages database transactions. Services enforce financial math using `Decimal`, state machine transitions, discount rules, tax resolution order, billing runs, and audit log writes.
3. **Models and repositories.** `app/models/` defines declarative SQLAlchemy 2.0 mapped models, database constraints, and indexes.

## 3. Subscription lifecycle state machine

```mermaid
stateDiagram-v2
    [*] --> draft: Create subscription or use template
    draft --> quotation: Validate minimum quantity and products
    quotation --> confirmed: Confirm quotation before expiration
    quotation --> draft: Revise quotation
    confirmed --> active: Activate on start date or manually
    active --> paused: Pause when plan permits
    paused --> active: Resume
    active --> closed: Close early when plan permits
    active --> closed: Auto-close on expiration
    closed --> [*]
    closed --> draft: Renew when plan permits
```

## 4. Billing engine and idempotency flow

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as APScheduler or Admin
    participant Engine as Billing engine
    participant Lock as PostgreSQL advisory lock
    participant DB as Database

    Scheduler->>Engine: Run billing(as_of_date, Idempotency-Key)
    Engine->>Lock: Acquire advisory lock
    Engine->>DB: Query due active subscriptions
    loop For each due subscription
        loop Catch up billing periods
            Engine->>Engine: Compute period dates with relativedelta
            Engine->>Engine: Resolve plan fee, lines, and variant prices
            Engine->>Engine: Resolve taxes by precedence
            Engine->>Engine: Apply best single discount rules
            Engine->>DB: Increment discount used_count atomically
            Engine->>DB: Issue invoice number from number_counters
            Engine->>DB: Insert invoice (draft)
            Note over DB: Guarded by UNIQUE(subscription_id, period_start)
            Engine->>DB: Update subscription next_invoice_date
        end
    end
    Engine->>DB: Commit transaction and write audit log
    Engine->>Scheduler: Return run counts and duration
```

## 5. Security and authentication design

1. **Password security.** The system hashes passwords using Argon2id. Passwords require nine characters, uppercase letters, lowercase letters, and symbols.
2. **Session management.** Short-lived access tokens stay in client memory for fifteen minutes. Refresh tokens travel in cookies marked `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Refreshing a token consumes it and returns a new token in the same family. Using a revoked token invalidates the entire family.
3. **Role-based access.** The server guards administrative routes using role dependencies (`require_roles`). Customer portal endpoints filter queries by the authenticated user customer id and return 404 for unowned records.
