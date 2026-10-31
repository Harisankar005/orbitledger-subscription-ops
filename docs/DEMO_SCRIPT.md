# Brightloop 5-Minute Live Judging Demo Script

This script provides an exact, rehearsed, minute-by-minute walkthrough to demonstrate Brightloop's end-to-end capabilities, business logic correctness, and engineering depth to hackathon judges.

---

### Demo Pre-requisites & Quick Launch
Before speaking to the judges, verify both processes are running:
1. **Backend**: `http://localhost:8000` (FastAPI)
2. **Frontend**: `http://localhost:5173` (React SPA)
3. **Mailpit UI**: `http://localhost:8025` (Local email inbox)

**Demo Credentials**:
- **Admin**: `admin@brightloop.test` / `Admin@1234`
- **Staff**: `staff1@brightloop.test` / `Staff@1234`
- **Customer**: `customer@brightloop.test` / `Customer@1234`

*(Tip: The login screen has one-click "Demo Fill" buttons for instant authentication)*

---

## ⏱️ Minute 0:00 – 1:00: The Problem & The Solution

**What to Say**:
> "Subscription businesses frequently struggle with three critical problems: fragmented billing that silently double-bills customers on retry, complex discount rules that erode margins through improper stacking, and lack of real-time visibility between operations and subscribers.
>
> We built **Brightloop** — a high-reliability subscription management platform built with Python 3.12, FastAPI, SQLAlchemy 2.0, PostgreSQL (with SQLite fallback), and React 18 TypeScript. It guarantees drift-free month-end billing, mathematical precision without floating-point errors, an append-only audit trail, and customer self-service."

**What to Show**:
- Open `http://localhost:5173/login`.
- Point out the clean UI, the live status indicator (`System Live: 100%`), and the one-click demo credentials.

---

## ⏱️ Minute 1:00 – 2:00: The Subscriptions Lifecycle & Pricing Variants

**What to Do**:
1. Click **"Demo Fill: Staff"** and log in as `staff1@brightloop.test`.
2. Navigate to **Catalog & Plans**:
   - Show the products, pointing to the **"Brand = Odoo (+₹560.00)"** variant configured on the ERP Connector.
   - Show the Tax Resolution precedence: Explicit line override > Product Default > Priority Tax Rules > 0 Tax.
3. Navigate to **Subscriptions** and click **"+ New Subscription"**:
   - Choose customer `Acme Corp`.
   - Select template `Professional Monthly Bundle`.
   - Show that lines populate automatically with base fees, variants, and resolved taxes.
4. Open the created subscription:
   - Walk through the visual **Lifecycle Stepper**: `Draft -> Quotation -> Confirmed -> Active`.
   - Click **"Generate Quotation"**: Show how validation gates enforce minimum quantity (`min_quantity`) before allowing exit from Draft.
   - Click **"Confirm Subscription"**: Status transitions smoothly with optimistic concurrency locking (`version`).

---

## ⏱️ Minute 2:00 – 3:00: The Billing Engine & Race-Proof Idempotency

**What to Do**:
1. Navigate to **Billing Engine** (`/billing`):
   - Explain: *"This engine bills recurring periods using drift-free relativedelta calculations (e.g. Jan 31 -> Feb 28 -> Mar 31) without calendar creep."*
2. Click **"Dry Run (Preview)"**:
   - Review pending subscriptions that need invoicing for the current date.
3. Click **"Execute Nightly Billing Run"**:
   - Watch the counter increment: *"Generated X invoices in Y milliseconds."*
4. **The Winning Edge Demo (Double Billing Proof)**:
   - Immediately click **"Execute Nightly Billing Run"** a second time.
   - Show the output: **0 New Invoices Created**.
   - Explain to the judges:
     > "Notice how running the billing engine again created zero duplicates. This is guaranteed by a compound database constraint `UNIQUE(subscription_id, period_start)` and serialized row locks. Even if two cron workers trigger simultaneously, double billing is mathematically impossible."

---

## ⏱️ Minute 3:00 – 4:00: Invoicing, Multi-Method Payments & Customer Portal

**What to Do**:
1. Navigate to **Invoices** (`/invoices`):
   - Show the newly generated invoice in `Confirmed` state.
   - Open the invoice detail to show the full breakdown: Base recurring fee, line discounts (D-004 best-single rule), resolved GST tax amounts, and clean printable layout.
2. Click **"Record Payment"**:
   - Enter a partial payment (e.g. ₹1,000 via `UPI`).
   - Show how the invoice status immediately updates to `Partially Paid` with the exact remaining balance displayed.
3. Log out and log in as **Customer** (`customer@brightloop.test`):
   - Show the dedicated **Customer Portal** (`/portal`):
   - Subscriber can view their active services, review the billing timeline, and see allowed self-service actions (Pause/Resume/Cancel governed by the plan settings).
   - Go to **My Invoices** and click **"Print"** to showcase the print-ready tax invoice.
   - Explain IDOR security: *"If this customer inspects network traffic and tries to access another customer's ID, Brightloop returns 404, preventing account enumeration."*

---

## ⏱️ Minute 4:00 – 5:00: Time-Travel Demo & Production Depth

**What to Do**:
1. Log back in as **Admin** (`admin@brightloop.test`):
2. Point to the top bar and click **"Time Travel (+1 Month)"**:
   - Explain: *"Our injected ClockService simulates moving 30 days into the future. The background worker automatically evaluates subscription renewals, overdue invoice dunning, and generates the next period's invoices."*
3. Visit the **Executive Dashboard** (`/`):
   - Show real-time MRR, active ARR, churn rate, and the **Overdue Aging Analysis** (0-30, 31-60, 61-90, 90+ days).
   - Click **"Export Subscriptions CSV"** to demonstrate instant CSV reporting.
4. Visit **Platform Admin**:
   - **Audit Log** (`/audit-log`): Show the immutable append-only ledger. Click **"View Diff"** on a state change to show the before and after JSON snapshots.
   - **Outbox Queue** (`/outbox`): Show transactional emails queued and sent. Switch tab to `http://localhost:8025` to show Mailpit receiving real HTML emails.
5. Wrap up:
   > "Brightloop combines 100% specification compliance with production hardening: 16 automated tests covering concurrency and auth matrices, sub-25ms p95 latencies, Argon2id auth with token rotation, and zero-compromise financial precision."

---

## Judge Q&A Quick Reference
If judges ask questions, refer directly to `docs/JUDGE_QA.md`:
- **"How do you prevent duplicate charges?"** -> `UNIQUE(subscription_id, period_start)` + row locking + `Idempotency-Key` headers.
- **"How does discount stacking work?"** -> ADR D-004: Best single product discount per line; best single subscription discount on remainder.
- **"What happens with Feb 28 to March 31 anchor dates?"** -> Python `dateutil.relativedelta` anchors to original subscription start date, eliminating date creep.
- **"Can customers access other tenants' data?"** -> Server-side customer scoping returns `404 Not Found` for any non-owned resource.
