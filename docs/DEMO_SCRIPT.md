# Five-minute demo script

**Project Builders (Odoo Hackathon):** B. Harisankar ([@Harisankar005](https://github.com/Harisankar005)) & Rohan S

This script guides a five-minute demonstration of Brightloop.

---

## Setup and test credentials

Start the backend and frontend processes before the demo:
1. Backend: `http://localhost:8000` (FastAPI)
2. Frontend: `http://localhost:5173` (React single-page app)
3. Local inbox: `http://localhost:8025` (Mailpit)

Demo credentials:
- Admin: `admin@brightloop.test` / `Admin@1234` (B. Harisankar)
- Staff: `staff1@brightloop.test` / `Staff@1234` (Rohan S)
- Customer: `customer@brightloop.test` / `Customer@1234`

The login page includes buttons to fill these credentials with one click.

---

## Minute 0 to 1: overview

Explanation:
> "Brightloop is a subscription management platform built with Python 3.12, FastAPI, SQLAlchemy 2.0, PostgreSQL with SQLite fallback, and React 18 TypeScript. It handles recurring billing without date drift, prevents floating-point rounding errors, tracks state changes in an append-only audit log, and provides customer self-service."

Action:
- Open `http://localhost:5173/login`.
- Point out the status indicator and test login buttons.

---

## Minute 1 to 2: subscription lifecycle and variants

Action:
1. Click the staff demo login button and sign in as `staff1@brightloop.test`.
2. Open Catalog and Plans:
   - Point to the product variant `Brand = Odoo (+₹560.00)` on the ERP Connector.
   - Note the tax resolution order: explicit line override, product default, priority tax rules, then zero tax.
3. Open Subscriptions and click New Subscription:
   - Select customer `Acme Corp`.
   - Select template `Professional Monthly Bundle`.
   - Lines populate with base fees, variants, and resolved taxes.
4. Open the created subscription:
   - Walk through the status stepper: Draft, Quotation, Confirmed, Active.
   - Click Generate Quotation: show that validation checks enforce minimum quantity before leaving Draft.
   - Click Confirm Subscription: the status updates with optimistic concurrency locking.

---

## Minute 2 to 3: billing run and idempotency

Action:
1. Open Billing Engine (`/billing`):
   - Explain: "This engine calculates billing cycles using anchored relativedelta arithmetic, avoiding month-end drift."
2. Click Dry Run:
   - Review pending subscriptions due for invoicing on the selected date.
3. Click Execute Nightly Billing Run:
   - The counter reports the number of invoices generated and elapsed time.
4. Verify duplicate billing protection:
   - Click Execute Nightly Billing Run a second time immediately.
   - The interface reports zero new invoices created.
   - Explain: "The database table enforces `UNIQUE(subscription_id, period_start)` alongside row locking. Sibling workers or network retries cannot produce duplicate charges."

---

## Minute 3 to 4: invoices, payments, and customer portal

Action:
1. Open Invoices (`/invoices`):
   - View the generated invoice in Confirmed status.
   - Open the invoice details to show line items: base recurring fee, line discounts evaluated under the best-single rule, taxes, and printable layout.
2. Click Record Payment:
   - Enter a partial payment of ₹1,000 using UPI.
   - The invoice status updates to Partially Paid and shows the remaining balance.
3. Sign out and sign in as Customer (`customer@brightloop.test`):
   - Open the Customer Portal (`/portal`).
   - View active subscriptions, billing history, and allowed actions (pause, resume, close).
   - Open My Invoices and click Print to open the print layout.
   - Note access isolation: "Querying another customer's ID returns 404, preventing account enumeration."

---

## Minute 4 to 5: clock advance, audit log, and reporting

Action:
1. Sign in as Admin (`admin@brightloop.test`).
2. Click Advance Time (+1 Month) in the top bar:
   - Explain: "The clock service advances the application date thirty days. The worker evaluates renewals, dunning rules, and subsequent period invoices."
3. Open Dashboard (`/`):
   - Review monthly recurring revenue, annual run rate, churn rate, and overdue invoice aging brackets (0-30, 31-60, 61-90, 90+ days).
   - Click Export Subscriptions CSV to download the data export.
4. Open Platform Administration:
   - Audit Log (`/audit-log`): view the append-only ledger. Click View Diff to display before and after JSON snapshots.
   - Outbox Queue (`/outbox`): view queued notification emails. Open `http://localhost:8025` to show Mailpit receiving rendered emails.
5. Summary:
   > "Brightloop meets the functional specification and includes operational hardening: 34 automated tests, sub-35ms p95 query latency, Argon2id authentication with token rotation, and Decimal financial arithmetic."

---

## Common questions

Detailed explanations are available in `docs/JUDGE_QA.md`:
- Preventing duplicate charges: `UNIQUE(subscription_id, period_start)`, row locks, and idempotency headers.
- Discount stacking: rule D-004 applies the best single product discount per line and the best single subscription discount to the remainder.
- Month-end anchor dates: `dateutil.relativedelta` anchors to the subscription start date, preventing creep from February 28 to March 28.
- Cross-tenant data isolation: queries filter by customer id and return 404 for unowned rows.
