# Brightloop Subscription Management System: Production Build Spec v2

Odoo hackathon, virtual round: 8 hours (9:00 to 17:00), team of up to 4, building with Antigravity.
**This file supersedes v1. Use only this one.**

> Honest framing: nobody can guarantee a win. This spec maximizes your odds by (1) covering every scene in the brief with correct business logic, (2) hitting every Odoo must-have visibly, (3) adding engineering depth judges rarely see in 8 hours (idempotent billing, concurrency safety, audit trail, tests, CI, containers), and (4) giving you evidence and a rehearsed demo. The biggest risk is not ambition, it is **unfinished scope**. Follow the priority tiers.

---

## 0. Priority tiers (this is how you stay on schedule)

| Tier | Meaning | Rule |
|---|---|---|
| **P0** | Every scene in the brief works end to end, validated, responsive, fast | Must be done by 15:00. Never cut. |
| **P1** | Production hardening: migrations, security, tests, CI, Docker, audit log, outbox emails, live updates | Build in parallel from hour 2. Cut last items first. |
| **P2** | Winning edge: dunning, MRR movement, time-travel demo, judging pack | Only after P0 is green on `main`. |

Cut order if behind: P2 extras, SSE live updates, CSV export, Playwright e2e, bulk actions, renewal flow, deployment. **Never cut:** auth and RBAC, state machines, idempotent billing, tax rules, discounts, payments, dashboard, validation, responsive UI, per-person Git commits.

---

## 1. Global rules for Antigravity (paste once as workspace rules, or prepend to every prompt)

```
You are building "Brightloop", a subscription management platform. Follow PLAN (this spec) exactly.

STACK (do not change without asking)
- Backend: Python 3.12, FastAPI, SQLAlchemy 2.x (typed), Alembic, Pydantic v2, PostgreSQL 16 (SQLite allowed only as a fallback via DATABASE_URL), PyJWT, argon2-cffi, slowapi, structlog, APScheduler (worker process), pytest, hypothesis, ruff, mypy (lenient).
- Frontend: React 18, Vite, TypeScript (strict), Tailwind, shadcn/ui (Radix), React Router, TanStack Query, react-hook-form + zod, Recharts, lucide-react, openapi-typescript + openapi-fetch for generated API types.
- Infra: Docker Compose (db, api, worker, web, mailpit), Makefile, GitHub Actions CI.

ENGINEERING RULES
1. Layering: routers (HTTP only) -> services (business rules, transactions) -> repositories/models. No business logic in routers or React components.
2. Money: Decimal only, Numeric(14,2) in DB, ROUND_HALF_UP per line, currency stored on documents (default INR). Never floats.
3. All state changes go through one service function per aggregate (subscription.transition, invoice.confirm, payment.record, billing.run). Each writes an AuditLog row in the same transaction.
4. Every list endpoint: pagination (page, page_size<=100), filters, deterministic ordering, indexed columns. Return {items,total,page,page_size}.
5. AuthZ is enforced on the server with dependencies (require_roles, ownership scoping). Customers requesting someone else's record get 404.
6. Validate everything with Pydantic; mirror rules in zod. Errors use one shape: {"code","message","fields":{"name":"msg"},"request_id"}.
7. Clock is injected (Clock service); never call date.today() directly. Business timezone Asia/Kolkata, stored dates are plain dates, timestamps UTC.
8. Write tests with the code. A task is DONE only when: ruff clean, tests pass, tsc passes, app runs, and you summarize files changed.
9. No secrets in git. Provide .env.example. No TODO placeholders in shipped code paths.
10. Keep files small. Add a one-line docstring explaining WHY on non-obvious logic.
11. If the spec is ambiguous, choose the simplest option, and add an entry to docs/DECISIONS.md.
```

---

## 2. Architecture

```
Browser (React SPA)
   │  same-origin /api (Vite proxy in dev, nginx in compose)
   ▼
FastAPI API  ──►  PostgreSQL 16  ◄──  Worker (APScheduler + outbox dispatcher)
   │                                         │
   └── SSE /api/events (live updates)        └── SMTP ──► Mailpit (local inbox UI :8025)
```

- **api**: stateless HTTP. **worker**: scheduled jobs (activate, auto-close, billing, dunning) and outbox email delivery, in its own process, guarded by a Postgres advisory lock so two workers never run the same job. For single-terminal dev set `EMBEDDED_WORKER=true`.
- **Offline-first demo**: everything (DB, mail inbox) runs locally in Docker. No external cloud service is required.
- **SQLite fallback**: portable SQLAlchemy only; Postgres-specific optimizations (`FOR UPDATE SKIP LOCKED`, advisory lock) sit behind `if dialect == "postgresql"`.

---

## 3. Roles and access matrix

| Capability | admin | staff | customer |
|---|---|---|---|
| Create staff users | ✅ | ❌ | ❌ |
| Products, variants, plans, taxes, tax rules, payment terms, quotation templates, discount rules (write) | ✅ | ❌ (read) | ❌ |
| Customers CRUD | ✅ | ✅ | own profile only |
| Subscriptions create/edit/transition | ✅ | ✅ | own: pause/close only if plan allows |
| Run billing, confirm/cancel/send/print invoices | ✅ | ✅ | print own only |
| Record payments | ✅ | ✅ | ❌ |
| Dashboard and reports | ✅ | ✅ | ❌ |
| Audit log, user management | ✅ | ❌ | ❌ |

Public signup always creates role `customer` plus a linked Customer record. **Generate an automated authorization test matrix** (every endpoint x every role) that asserts 200/403/404 as expected. This single test is strong evidence of rigor.

---

## 4. Data model (PostgreSQL)

Common columns: `id` (bigint identity), `created_at`, `updated_at`; mutable aggregates also have `version` (int) for optimistic locking. Index all FKs. Use `CHECK` constraints for enums and numeric ranges (defence in depth).

**Identity**
- `users`: email (citext or lower-unique index), password_hash (argon2id), role, full_name, is_active, failed_logins, locked_until
- `refresh_tokens`: user_id, family_id, token_hash, expires_at, revoked_at, replaced_by
- `password_reset_tokens`: user_id, token_hash (sha256), expires_at, used_at
- `customers`: user_id (nullable, unique), name, email, phone, company, billing_address, tax_id

**Catalog**
- `products`: name, type (`software|addon|service|physical`), sales_price, cost_price, notes, default_tax_id, is_active
- `product_variants`: product_id, attribute, value, extra_price (may be negative), UNIQUE(product_id, attribute, value)
- `taxes`: name, kind (`percent|fixed`), rate, is_active
- `tax_rules`: product_type (nullable = any), tax_id, priority, is_active ("rules the admin has set")
- `payment_terms`: name, days (0 = immediate)
- `plans`: name, price (base fee per period), billing_period (`daily|weekly|monthly|yearly`), min_quantity, available_from, available_to, default_tax_id, auto_close_on_end, allow_early_close, allow_pause, allow_renew
- `quotation_templates`: name, plan_id, validity_days, payment_term_id, is_active
- `quotation_template_lines`: template_id, product_id, variant_id, quantity

**Subscriptions**
- `subscriptions`: number (unique), customer_id, plan_id, template_id, status, start_date, expiry_date, payment_term_id, quotation_valid_until, billing_anchor (= start_date), periods_billed (int), next_invoice_date, currency, notes, version
- `subscription_lines`: subscription_id, product_id, variant_id, description, quantity, unit_price (snapshot), tax_id (resolved snapshot), amount
- `subscription_status_history`: subscription_id, from_status, to_status, changed_by, changed_at, reason

**Billing**
- `discount_rules`: name, kind (`fixed|percent`), value, min_purchase_amount, min_quantity, start_date, end_date, usage_limit, used_count, scope (`product|subscription`), product_id, target_subscription_id (nullable), is_active
- `invoices`: number (unique), subscription_id, customer_id, period_start, period_end, issue_date, due_date, status, subtotal, discount_total, tax_total, total, amount_paid, currency, sent_at, version, **UNIQUE(subscription_id, period_start)**
- `invoice_lines`: invoice_id, source (`plan_fee|product`), product_id, description, quantity, unit_price, discount_amount, tax_id, tax_amount, line_total
- `applied_discounts`: invoice_id, invoice_line_id (nullable), discount_rule_id, amount
- `payments`: invoice_id, method (`cash|card|upi|bank_transfer|cheque`), amount, paid_on, note, recorded_by, idempotency_key (unique nullable)
- `number_counters`: name (`SUB`,`INV`), next_value (locked with `FOR UPDATE` when issuing a number, race-safe)

**Platform**
- `audit_log`: actor_id, action, entity_type, entity_id, before (jsonb), after (jsonb), request_id, at (append-only; no update/delete endpoints)
- `outbox_messages`: to_email, subject, body_html, kind, status (`pending|sent|failed`), attempts, last_error, created_at, sent_at, dedupe_key (unique nullable)
- `idempotency_keys`: key, endpoint, request_hash, response_json, created_at (for POST /billing/run)

**Required indexes**: subscriptions(status, next_invoice_date), subscriptions(customer_id, status), invoices(status, due_date), invoices(customer_id, created_at desc), invoices(subscription_id), payments(paid_on), payments(invoice_id), customers(lower(name)), partial index on invoices(due_date) WHERE status='confirmed'.

---

## 5. Business rules (the logic judges will test)

### 5.1 Authentication and account security
- Email: trimmed, lowercased, unique (also enforced by DB index).
- Password: **more than 8 characters (min 9, max 128)**, at least one uppercase, one lowercase, one special (non-alphanumeric) character. Live checklist in the UI. Hash with **argon2id**.
- Access JWT (15 min) held in memory; refresh token in an `httpOnly; Secure; SameSite=Strict; Path=/api/auth` cookie, **rotated on every use** with reuse detection (reuse of a revoked token revokes the whole family). Logout revokes.
- Rate limits (slowapi): login 5/min per IP+email, forgot-password 3/hour per IP+email. Lock the account 15 min after 5 consecutive failures.
- Forgot password: always respond with the same generic message. Token = 32 random bytes urlsafe, store only its SHA-256, valid 30 min, single use. Email goes through the outbox (Mailpit locally). Resetting revokes all refresh tokens.
- Security headers (CSP, X-Content-Type-Options, Referrer-Policy, frame-ancestors none), strict CORS (same-origin by default), request body size limit, no stack traces in responses.

### 5.2 Pricing and tax resolution
- Line `unit_price = product.sales_price + variant.extra_price` (snapshot at the time the line is created; later catalog edits never change existing subscriptions or invoices).
- Plan `price` is the **base recurring fee** and is billed as an automatic `plan_fee` line; product lines are seats, add-ons and variants. (Decision D-001; record it in DECISIONS.md.)
- Plan `min_quantity` = minimum **total quantity across product lines** of a subscription on that plan (D-002). Enforced when leaving draft.
- A plan can only be chosen if the subscription start date is within `available_from..available_to`.
- **Tax resolution order for a line**: explicit line tax, else product.default_tax_id, else highest-priority active `tax_rule` matching product type, else none. Plan fee uses plan.default_tax_id. Resolve once and snapshot `tax_id` on the line.
- `percent`: `tax = taxable * rate / 100`; `fixed`: `tax = rate * quantity`. Taxable = line amount minus line discount. Round per line (HALF_UP), then sum. `total = subtotal - discount_total + tax_total`.

### 5.3 Subscription lifecycle (single `transition()` function)
```
draft ──► quotation ──► confirmed ──► active ──► closed
                                       ▲  │
                                       └──┴── paused   (only if plan.allow_pause)
```
- draft → quotation: needs ≥1 line; plan available; min_quantity satisfied; sets `quotation_valid_until = today + template.validity_days` when from a template.
- quotation → confirmed: rejected if quotation expired (shown as "Expired").
- confirmed → active: manual, or by worker on `start_date`. Sets `next_invoice_date = start_date`.
- active → closed early: only if `plan.allow_early_close`, otherwise 409 with a clear message.
- Auto-close: worker closes `active` subscriptions with `expiry_date < today` when `plan.auto_close_on_end`.
- Renew: only if `plan.allow_renew`; creates a new subscription (new number) copying lines, starting the day after expiry; old one becomes closed.
- Illegal transitions → 409 `{"code":"ILLEGAL_TRANSITION","message":"..."}`. Each transition writes `subscription_status_history` and `audit_log`. The detail page shows a stepper and timeline so anyone can see where it stands.
- Quotation templates: "New from template" copies plan, payment term and lines; lines stay editable while draft.

### 5.4 Billing engine ("billing day": nothing twice, nothing skipped)
Algorithm `billing.run(as_of_date, dry_run=False)`:
1. Select due subscriptions in batches of 200: `status='active' AND next_invoice_date <= as_of_date AND next_invoice_date <= expiry_date`, ordered by id, using `FOR UPDATE SKIP LOCKED` on Postgres.
2. For each, in **its own transaction**, loop while `next_invoice_date <= as_of_date` (catches up missed periods):
   - `period_start = billing_anchor + periods_billed * period` using `relativedelta` from the **anchor** (never iterative addition, so a month-end anchor of Jan 31 gives Feb 28/29 then Mar 31, with no drift).
   - `period_end = (anchor + (periods_billed+1) * period) - 1 day`.
   - Build lines (plan fee + product lines), resolve taxes, evaluate discounts, compute totals, issue the number from `number_counters`, set `due_date = issue_date + payment_term.days`.
   - Insert the invoice (status `draft`). The **UNIQUE(subscription_id, period_start)** constraint is the final guard: on IntegrityError roll back that period and count it as `skipped_already_billed`.
   - Increment `periods_billed`, set the new `next_invoice_date`. Failure in one subscription never aborts the batch; record it in `failed` with a reason.
3. No proration (documented limitation D-003): a period is billed in full if it starts on or before `expiry_date`.
4. Result: `{created, skipped_already_billed, skipped_not_due, failed:[{subscription, reason}], duration_ms}`. `POST /billing/run` requires an `Idempotency-Key` header; the same key returns the stored response.
5. **Acceptance test**: run twice → second run creates 0. Kill the worker mid-run → rerun completes without duplicates or gaps. Two concurrent runs → no duplicates (test with threads on Postgres).

### 5.5 Discounts (admin-only rules, automatic application)
- Eligible when: `is_active`, today within `[start_date, end_date]`, `used_count < usage_limit` (if set), applicable subtotal ≥ `min_purchase_amount`, quantity ≥ `min_quantity`, and scope matches (`product` → lines of `product_id`; `subscription` → whole invoice, optionally limited to `target_subscription_id`).
- Stacking (D-004): per line apply the **best single** eligible product-scoped rule; per invoice apply the **best single** eligible subscription-scoped rule on the post-line-discount subtotal. A discount never exceeds its base amount.
- Usage count is incremented with an atomic `UPDATE ... SET used_count = used_count + 1 WHERE id=:id AND (usage_limit IS NULL OR used_count < usage_limit) RETURNING id`; if zero rows, the rule is skipped (so concurrent billing cannot exceed the limit). Write `applied_discounts` in the same transaction.
- After `end_date` or exhaustion the rule simply stops matching. No manual step.

### 5.6 Invoice lifecycle
`draft → confirmed → paid`, plus `cancelled` (only from draft, or from confirmed with zero payments).
- Actions: confirm, cancel, **send** (enqueue outbox email with the invoice HTML and set `sent_at`), **print** (print-optimized HTML page, `window.print()` produces a PDF).
- Confirmed invoices are immutable. Optimistic locking via `version`; stale writes → 409.
- Bulk confirm/send with per-row result reporting.

### 5.7 Payments
- Record against a **confirmed** invoice: `method`, `amount`, `paid_on`, `note`. Validation: `0 < amount ≤ total - amount_paid`, `paid_on ≤ today`.
- Lock the invoice row (`FOR UPDATE`), insert payment, update `amount_paid`, set `paid` when `amount_paid ≥ total`. Optional `Idempotency-Key` prevents double submit.
- Derived display status: **Paid, Partially paid, Outstanding, Overdue** (`confirmed AND due_date < today AND amount_paid < total`).

### 5.8 Reporting (all SQL aggregates, never Python loops)
- **Active subscriptions**, **MRR** (normalized: daily×30, weekly×52/12, monthly×1, yearly÷12; active only), **revenue collected** (sum of payments in range), **invoiced vs collected**, **outstanding**, **overdue** (count, amount, aging buckets 1-30/31-60/61+ days).
- Filters: date range, customer, plan, status. Summary view (cards + charts) and a print-friendly summary page. CSV export for overdue and payments.
- Response cache of 15 seconds on dashboard aggregates (in-process TTL cache), invalidated on payment/billing events.

### 5.9 Live data (satisfies "real-time or dynamic data")
- `GET /api/events` (Server-Sent Events) emits `invoice.created`, `payment.recorded`, `billing.completed`. Dashboard and lists subscribe and refetch affected queries. Show a small "Live" indicator. (Single-process broadcaster; note Postgres LISTEN/NOTIFY as the scale-out path.)

### 5.10 P2 winning edge (only after P0 is green)
1. **Dunning**: worker queues reminder emails for invoices at due-3 days, due date, +3, +7 (deduped by `dedupe_key`). Visible in the Mailpit inbox and an "Outbox" admin page. Directly answers "overdue ones can be chased before they turn into lost revenue."
2. **MRR movement**: new, expansion, contraction, churned MRR for the selected month (derived from status history and line changes). One compact chart.
3. **Time-travel demo mode** (`DEMO_MODE=true`, admin only): button "Advance billing date by 1 month" that sets the injected Clock offset, then runs billing, so you can demo a full billing cycle in seconds.
4. **Audit log viewer** with filters (entity, actor, date).

---

## 6. API surface (REST, prefix `/api`, OpenAPI at `/api/docs`)

```
Auth       POST /auth/register|login|refresh|logout|forgot-password|reset-password   GET /auth/me
Users      POST /users/staff (admin)  GET /users (admin)  PATCH /users/{id} (admin)
Customers  GET|POST /customers   GET|PATCH /customers/{id}
Catalog    /products /products/{id}/variants /taxes /tax-rules /payment-terms /plans /quotation-templates  (admin write)
Subs       GET|POST /subscriptions   GET|PATCH /subscriptions/{id}   POST /subscriptions/from-template/{id}
           POST /subscriptions/{id}/transition   POST /subscriptions/{id}/renew
Discounts  GET|POST /discounts   PATCH /discounts/{id}                 (admin write)
Billing    POST /billing/run {as_of_date?, dry_run?}  (Idempotency-Key)
Invoices   GET /invoices   GET /invoices/{id}   POST /invoices/{id}/confirm|cancel|send   POST /invoices/bulk
           GET /invoices/{id}/print
Payments   GET /payments   POST /invoices/{id}/payments
Reports    GET /reports/summary|overdue|revenue-by-month|status-breakdown|payment-methods|mrr-movement   GET /reports/export/{kind}.csv
Portal     GET /portal/subscriptions|invoices   POST /portal/subscriptions/{id}/transition
Platform   GET /health  GET /ready  GET /events (SSE)  GET /audit-log (admin)  GET /outbox (admin)
```

Ship the OpenAPI JSON in the repo and generate TypeScript types from it (`npm run gen:api`). **Contract first**: the backend lead publishes stubs for every endpoint in the first hour so frontend work never blocks.

---

## 7. Frontend specification

- **Design system**: shadcn/ui on Tailwind, one palette (indigo-600 primary, slate neutrals, emerald/amber/rose status), one spacing scale, one type scale. Status badges are consistent everywhere.
- **Layout**: admin/staff shell with collapsible sidebar (hamburger under 768px), top bar with global search and user menu, breadcrumbs on detail pages. Customer portal has a simple top nav.
- **Pages**: Login, Sign up, Forgot/Reset password · Dashboard · Customers · Subscriptions (list, detail with stepper and timeline, editor) · Templates · Invoices (list, detail, print) · Payments · Billing (preview then run) · Catalog (Products and variants, Plans, Taxes, Tax rules, Payment terms, Discounts) · Users · Audit log · Outbox · Portal (My subscriptions, My invoices, Profile).
- **State and forms**: URL-driven filters and pagination, TanStack Query with `staleTime` 30s, debounced search 300ms, react-hook-form + zod mirroring server rules, field-level errors from the server `fields` map.
- **Quality bar**: skeleton loaders, empty states with call to action, error boundary per route, toasts, confirmation dialogs for destructive actions, buttons disabled while submitting, 44px touch targets, visible focus rings, labels on every input, `aria-live` for toasts, keyboard-operable dialogs, color contrast ≥ 4.5:1.
- **Responsive**: verified at 375, 768, 1280 px. Tables become stacked cards under 640px. No horizontal page scroll. Route-level code splitting; production build served by nginx with gzip and caching.
- **Print**: dedicated print stylesheet for invoices and the finance summary.

---

## 8. Quality, security and performance gates

**Testing**
- Backend: unit tests for pricing, tax, discount, state machine; integration tests per router; **authorization matrix test**; **billing idempotency and concurrency tests**; Hypothesis property tests (invoice total = sum of lines; rounding never loses more than 0.01 per line; billing twice is a no-op). Target ≥ 80% coverage on `services/`.
- Frontend: typecheck + lint + build in CI; component tests for password checklist and payment form; **one Playwright e2e** of the golden path (signup → admin creates plan → staff creates subscription → billing → payment → dashboard).

**CI (GitHub Actions)**: jobs `backend` (ruff, mypy, pytest with Postgres service, coverage), `frontend` (tsc, eslint, vitest, build), `e2e` (optional, docker compose). Branch protection: PR required, CI green. Add a PR template and CODEOWNERS (also proves multi-member Git use).

**Security checklist**: argon2id, refresh rotation, rate limits, lockout, no user enumeration, parameterized queries only, server-side authz, IDOR tests, CSP, secrets via env, dependency audit (`pip-audit`, `npm audit`) recorded in README.

**Performance budgets (measure and screenshot for the demo)**
- Seeded: 200 customers, **5,000 subscriptions, ~20,000 invoices, ~12,000 payments**.
- p95 server time: list endpoints < 300 ms, dashboard summary < 800 ms, billing run for 1,000 due subscriptions < 20 s. Every page interactive in < 2 s (hard requirement).
- A script `make perf` hits key endpoints 50 times and prints p50/p95; commit the output to `docs/PERFORMANCE.md`. Use `EXPLAIN ANALYZE` on the three heaviest queries and note the indexes used.

**Observability**: structlog JSON logs with `request_id` (also returned in the `X-Request-ID` header and in error bodies), `/health` (liveness), `/ready` (DB check), billing run summaries logged with counts and duration.

---

## 9. Repository layout

```
/
  PLAN.md  README.md  Makefile  docker-compose.yml  .github/workflows/ci.yml  .github/pull_request_template.md  CODEOWNERS
  docs/ ARCHITECTURE.md  DECISIONS.md  PERFORMANCE.md  SECURITY.md  DEMO_SCRIPT.md  JUDGE_QA.md
  backend/
    pyproject.toml  Dockerfile  alembic.ini  alembic/versions/
    app/
      main.py  config.py  clock.py  db.py  security.py  deps.py  errors.py  logging.py  events.py
      models/  schemas/  routers/  services/  repositories/
      worker.py  seed.py
    tests/ unit/ integration/ concurrency/ authz/
  frontend/
    Dockerfile  nginx.conf  vite.config.ts  src/{api,components/ui,components/layout,features/*,pages,hooks,lib}  e2e/
```

`Makefile` targets: `make up` (compose up), `make migrate`, `make seed`, `make seed-small`, `make test`, `make perf`, `make demo` (reset DB + migrate + seed + start), `make lint`.

---

## 10. Seed and demo data

`python -m app.seed [--small]` is deterministic (fixed random seed) and idempotent per run on a clean DB. It creates: admin (`admin@brightloop.test` / `Admin@1234`), 2 staff, 5 products with variants (include Brand=Odoo **+560**), 3 taxes (GST 18%, GST 5%, a fixed fee), tax rules by product type, 3 payment terms, 6 plans (all four periods; mix of flags), 2 quotation templates, 4 discount rules (one expired, one nearly exhausted, one product-scoped, one subscription-scoped), customers, subscriptions in every status, invoices in every status including **realistic overdue aging**, and payments by all methods. Print the demo logins at the end. Also seed one customer user with a known password for the portal demo.

---

## 11. Team split and Git workflow

| Owner | Scope | Branches |
|---|---|---|
| **A (lead)** | Repo, Docker/CI/Makefile, auth and security, RBAC and authz test matrix, audit log, deploy | `feat/platform-*`, `feat/auth-*` |
| **B** | Catalog, tax rules, plans, templates, discounts, seed data | `feat/catalog-*` |
| **C** | Subscriptions, billing engine, invoices, payments, worker, outbox, reports | `feat/billing-*` |
| **D** | Frontend shell, design system, all UI, dashboard, portal, e2e | `feat/ui-*` |

If you have fewer people, one person holds multiple scopes but still commits per module.

- `main` is protected and always runnable. PRs need one teammate review. Merge **at least hourly**. Squash-merge is fine, but each person must have many real commits before squash.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Target ≥ 10 commits per person.
- Each person feeds Antigravity only their own module, **reads and edits the output**, runs tests, and commits under their own name. If Antigravity supports parallel agents, run one agent per branch or worktree.
- Only the lead edits `main.py` router registration and shared UI primitives; others announce changes in chat first.

---

## 12. Timeline (9:00 to 17:00)

| Time | Everyone | Exit check |
|---|---|---|
| 9:00 to 9:30 | Read statement and email, confirm leader submits the problem, create repo, add this spec as `PLAN.md`, assign owners | Repo cloned by all |
| 9:30 to 10:30 | **Contract-first**: Prompts 1 to 3 (scaffold, models + migrations, auth). D builds shell with mocked API | `make up` works; login for all roles |
| 10:30 to 12:00 | Prompts 4 to 7: catalog, plans, tax rules, templates, subscriptions, state machine, discounts | Create from template, activate, illegal transition blocked |
| 12:00 to 13:30 | Prompts 8 to 10: billing engine, invoices, payments, outbox, worker | Billing twice = 0 new invoices; payment flips to Paid |
| 13:30 to 14:00 | Lunch while CI runs; merge everything; smoke test on fresh clone | `main` green |
| 14:00 to 15:00 | Prompts 11 to 12: dashboard, reports, SSE, portal; UI integration | Dashboard numbers equal DB queries |
| 15:00 to 16:00 | Prompts 13 to 15: bulk seed + perf, authz matrix, validation, responsive and a11y sweep, P2 items if green | Acceptance checklist (section 14) passes |
| 16:00 to 16:40 | Prompt 16: docs, screenshots, record demo video, deploy if allowed | Submission assets ready |
| 16:40 to 17:00 | **Submit early.** Re-read email instructions. | Confirmation received |

---

## 13. Prompts for Antigravity (paste in order, one per task; each ends with the Definition of Done from rule 8)

**P1 Scaffold and infra**
```
Read PLAN.md sections 1, 2, 9. Create the monorepo: FastAPI app (config via pydantic-settings, structlog with request_id middleware, error handlers using the standard error shape, /health and /ready), SQLAlchemy 2 engine, Alembic, Clock service, Dockerfiles, docker-compose (db, api, worker, web, mailpit), Makefile, .env.example, GitHub Actions CI (backend: ruff, mypy, pytest with Postgres service; frontend: tsc, eslint, vitest, build), PR template. Frontend: Vite React TS strict, Tailwind, shadcn/ui, React Router, TanStack Query, openapi-fetch client and a `gen:api` script. `make up` must start everything.
```

**P2 Models and migrations**
```
Implement every table in PLAN.md section 4 as SQLAlchemy models with constraints, CHECKs, indexes, version columns, and the UNIQUE(subscription_id, period_start) on invoices. Create the initial Alembic migration. Implement number_counters-based numbering (SUB-000001, INV-000001) with a row lock. Tests: constraint violations, numbering under concurrent calls.
```

**P3 Auth, security, RBAC**
```
Implement PLAN.md 5.1 and section 3: register, login (access JWT 15m), rotating refresh cookie with reuse detection, logout, forgot/reset password via outbox, argon2id, rate limits, lockout, security headers, require_roles and ownership scoping dependencies, POST /users/staff admin-only, audit logging helper. Tests: duplicate email, each password rule, lockout, refresh reuse detection, reset token expiry/reuse, role violations. Frontend: Login, Signup with live password checklist, Forgot, Reset, AuthProvider with silent refresh, protected routes, role-based redirects.
```

**P4 Catalog**
```
Implement products + variants, taxes, tax_rules, payment_terms, plans (all flags and availability dates) per PLAN.md 4, 5.2 and section 9 validation. Admin-write, staff-read. Tax resolution function with unit and Hypothesis tests. Frontend: Catalog area with variants inline editor (Brand=Odoo adds 560), plan form with the four billing periods and allow_* toggles, tax rule priority editor.
```

**P5 Templates and subscriptions**
```
Implement quotation templates and subscriptions per PLAN.md 5.3: from-template creation, lines with price snapshots and resolved taxes, min_quantity and availability checks, the single transition() function with status history and audit log, quotation expiry, renew, optimistic locking. Tests for every legal and illegal transition and each plan flag. Frontend: list with status tabs and filters; detail with stepper, timeline, line editor, and only-legal action buttons.
```

**P6 Discounts**
```
Implement discount rules (admin write) and the eligibility/stacking engine per PLAN.md 5.5 including atomic usage increments. Tests: fixed vs percent, min purchase, min quantity, date window, usage limit under concurrent calls, product vs subscription scope, target_subscription_id, never exceeding base. Frontend: Discounts admin page with validation, status chips (Active, Scheduled, Expired, Exhausted).
```

**P7 Billing engine**
```
Implement PLAN.md 5.4 exactly: batched selection with SKIP LOCKED on Postgres, anchor-based period math with relativedelta, per-subscription transactions, catch-up of missed periods, plan fee + product lines, taxes, discounts, due dates from payment terms, idempotency keys, dry_run. Tests: twice = zero new, month-end anchor (Jan 31), paused skipped, expiry cutoff, kill-and-resume, two concurrent runs on Postgres, Hypothesis totals property. Add the worker process with advisory-lock-guarded jobs (activate at start_date, auto-close, nightly billing).
```

**P8 Invoices and outbox**
```
Implement invoice list/detail, confirm, cancel, send, bulk actions, print view, immutability after confirm, and the outbox dispatcher (SMTP to Mailpit, retries with backoff, dedupe_key). Tests for lifecycle and edge cases. Admin Outbox page.
```

**P9 Payments**
```
Implement PLAN.md 5.7 with row locking, partial payments, idempotency, derived statuses. Tests: overpayment rejected, partial then full, unconfirmed invoice rejected, double-submit with same Idempotency-Key, concurrent payments cannot overpay.
```

**P10 Billing, invoices, payments UI**
```
Build staff UI: Invoices (filters, bulk confirm/send, per-row results), invoice detail (lines, tax, discount, totals, actions, payment panel and history), Payments page with Record payment dialog, Billing page with Preview (dry run) then Run, showing created/skipped/failed. Use generated API types and server field errors.
```

**P11 Reports and live updates**
```
Implement PLAN.md 5.8 and 5.9: summary, overdue with aging buckets, revenue-by-month, status breakdown, payment methods, CSV export, 15s TTL cache with invalidation, and the SSE /events endpoint. Frontend Dashboard: KPI cards, filter bar, Recharts charts, overdue table, Live indicator, print-friendly summary.
```

**P12 Customer portal**
```
Build the portal and /portal endpoints: own subscriptions (pause/close only if plan flags allow, via the same transition()), own invoices with printable view and outstanding total, profile edit. Tests proving customer A cannot access customer B's data (404) on every portal route.
```

**P13 Seed and performance**
```
Implement section 10 seed (full and --small), bulk inserts, deterministic. Add `make perf` script, run EXPLAIN ANALYZE on the 3 heaviest queries, add any missing indexes, and write docs/PERFORMANCE.md with p50/p95 results against the budgets in section 8.
```

**P14 Authorization matrix and hardening**
```
Generate the endpoint x role authorization test matrix from the OpenAPI schema. Run pip-audit and npm audit and record results in docs/SECURITY.md. Verify headers, rate limits, no stack traces, and that errors always carry request_id.
```

**P15 Validation, responsive and a11y sweep**
```
Audit every form against section 9 of the original validation matrix and PLAN.md 5.x on client and server; fix gaps. Verify 375/768/1280 layouts, tables-to-cards, no horizontal scroll, focus states, labels, aria-live toasts, contrast. Add the Playwright golden-path e2e. List anything still broken.
```

**P16 Docs and judging pack**
```
Write README (problem-to-feature mapping for every scene, 5-command setup, demo logins, architecture diagram in Mermaid, test and perf evidence, known limitations), ARCHITECTURE.md, DECISIONS.md (D-001 to D-00x), SECURITY.md, DEMO_SCRIPT.md, and JUDGE_QA.md using section 15 as the base.
```

(P2 extras, if time: dunning, MRR movement, demo time-travel, audit log viewer, each as its own small prompt referencing section 5.10.)

---

## 14. Final acceptance checklist

**Scenes from the brief**
- [ ] Signup: unique email, password rule enforced client and server, reset link works (visible in Mailpit), roles separated, only admin adds staff
- [ ] Product with Brand=Odoo variant shows +560; plan with all four billing periods, min quantity, availability dates, per-plan close/pause/renew flags
- [ ] Quotation template → subscription; Draft→Quotation→Confirmed→Active→Closed visible; illegal moves blocked
- [ ] Billing run creates complete invoices (customer, lines, taxes, totals); **second run creates 0**; paused/expired skipped; missed periods backfilled
- [ ] Tax rules applied automatically; discount rules admin-only; discount appears on next invoice by itself and stops at end date or usage limit
- [ ] Confirm, cancel, send, print work; Draft→Confirmed→Paid
- [ ] Payments with method, amount, date, note; partial and full; paid vs outstanding vs overdue visible
- [ ] Dashboard: active subscriptions, MRR, revenue, outstanding, overdue, filters, summary view

**Odoo must-haves**
- [ ] Live data (DB + SSE updates, no static JSON) · [ ] Responsive consistent UI · [ ] Robust validation · [ ] Clear navigation · [ ] Everyone committed with PRs

**Engineering evidence**
- [ ] CI green on `main` · [ ] Authz matrix passes · [ ] Concurrency tests pass · [ ] p95 and 2-second budgets documented · [ ] `docker compose up` works on a fresh clone · [ ] No secrets committed · [ ] README + demo video done

---

## 15. Judge Q&A cheat sheet (every member should be able to answer)

1. **How do you prevent double billing?** DB UNIQUE(subscription_id, period_start), per-subscription transactions, row locks with SKIP LOCKED, idempotency keys, and tests including concurrent runs.
2. **What if the scheduler was down for days?** Billing loops from `next_invoice_date` until caught up; period math is anchored so month-end dates do not drift.
3. **Why Decimal and per-line rounding?** Avoid float errors; per-line HALF_UP matches how invoices are audited; a property test checks totals.
4. **How do taxes get chosen?** Line override, product default, then admin tax rule by product type and priority; resolved once and snapshotted.
5. **How are discounts kept from over-applying?** Atomic conditional increment of `used_count`, date window, caps at base amount, single best rule per scope.
6. **Who can do what and how do you prove it?** Server-side `require_roles` plus ownership scoping, and an auto-generated endpoint-by-role test matrix.
7. **How is auth hardened?** Argon2id, short JWT, rotating httpOnly refresh with reuse detection, rate limits, lockout, enumeration-safe reset.
8. **How do you hit under 2 seconds with thousands of rows?** Pagination, composite and partial indexes, SQL aggregates, TTL cache; evidence in PERFORMANCE.md.
9. **What happens if catalog prices change later?** Lines and invoices snapshot price and tax; history is unaffected.
10. **How do you handle email without internet?** Outbox pattern with Mailpit locally; retries and dedupe.
11. **Why is billing in a worker?** Isolation from request latency, single-runner via advisory lock, safe restarts.
12. **What are the known limitations?** No proration, single-currency per document, in-process SSE broadcaster (path: LISTEN/NOTIFY), no payment gateway integration. State them honestly.
13. **How did you use AI?** Each member owned a module, reviewed and tested the output; prompts and decisions are in the repo.

---

## 16. Demo script (4 minutes, rehearse twice, keep a recorded backup)

1. **Problem in one sentence** (10s): "Brightloop earns monthly; this replaces spreadsheets and manual invoices."
2. **Signup and security** (25s): weak password → checklist errors; duplicate email error; sign in; show Mailpit reset link.
3. **Admin setup** (45s): product with Brand=Odoo (+560), monthly plan with flags, tax rule, 10% discount for 10+ seats.
4. **Staff** (45s): subscription from template → stepper through to Active; show timeline; try an illegal move.
5. **Billing day** (45s): Preview, Run (N invoices, taxes, discount shown), Run again → **0 created**. Show the number of rows and the duration.
6. **Money in** (30s): confirm and send an invoice (appears in Mailpit), partial payment then remainder → Paid.
7. **Finance lead** (30s): live dashboard updating as the payment lands, filters, overdue aging, thousands of rows loading fast; show `PERFORMANCE.md` numbers.
8. **Portal and RBAC** (15s): customer sees only their own data.
9. **Engineering close** (15s): CI green, authz matrix, concurrency tests, Git graph with all members.

---

## 17. Risks and fallbacks

- **Docker not available on a teammate's machine:** set `DATABASE_URL` to SQLite and run `uvicorn` + `npm run dev` directly (Postgres-only optimizations are dialect-guarded).
- **Antigravity breaks something:** commit only green states; revert instead of debugging for long; re-prompt with the failing test output.
- **Behind schedule at 13:30:** freeze P2 and P1 extras; ship P0 polished. A smaller finished product beats a larger broken one.
- **Deployment:** only if the rules ask for a live link or time remains. Options: Render/Railway/Fly for api+worker+Postgres, Vercel/Netlify or nginx for the SPA. Otherwise use `docker compose` plus the demo video. Check the email instructions at 9:00.
- **Submission:** the team leader submits; do it by 16:40, then verify the confirmation.
