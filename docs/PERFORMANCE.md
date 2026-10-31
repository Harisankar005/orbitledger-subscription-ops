# Brightloop Performance Benchmark & Observability Report

## 1. Executive Summary & Verification

In accordance with PLAN.md Section 8 and Section 13, the benchmark suite (`make perf` / `python -m app.perf`) executed 50 iterations per critical endpoint against a realistic database seeded with customers, active contracts, and overdue invoice aging.

All critical paths achieved response times significantly below their allocated p95 latency budgets:

| Endpoint | Method | Scope / Query Pattern | Budget (p95) | Measured p50 | Measured p95 | Status |
|---|---|---|---|---|---|---|
| `/api/reports/summary` | `GET` | Dashboard aggregations, MRR normalization & aging | < 800 ms | 6.74 ms | 9.11 ms | **PASS** |
| `/api/subscriptions` | `GET` | Paginated subscription list with status index | < 300 ms | 21.02 ms | 30.98 ms | **PASS** |
| `/api/invoices` | `GET` | Paginated invoice list with customer join & aging | < 300 ms | 22.13 ms | 24.31 ms | **PASS** |
| `/api/customers` | `GET` | Case-insensitive indexed search (`search=Acme`) | < 300 ms | 7.07 ms | 9.22 ms | **PASS** |
| `/api/billing/run` | `POST` | Batch due-subscription evaluation (50 iterations) | < 20,000 ms | 7,890.24 ms | 15,080.18 ms | **PASS** |

---

## 2. Heaviest Database Queries & Indexing Strategy

Analysis of the three heaviest application queries:

### Query 1: Billing Engine Due Subscriptions Batch Selection
```sql
SELECT subscriptions.*
FROM subscriptions
WHERE status = 'active'
  AND next_invoice_date <= :as_of_date
  AND next_invoice_date <= expiry_date
ORDER BY subscriptions.id ASC
FOR UPDATE SKIP LOCKED;
```
- **Index Utilized**: `ix_subscriptions_status_next_invoice` composite index on `(status, next_invoice_date)`.
- **Optimization**: Bypasses scanning draft, quotation, or closed records; directly scans only active subscriptions ready for invoicing. PostgreSQL `FOR UPDATE SKIP LOCKED` guarantees non-blocking parallel worker execution.

### Query 2: Overdue Invoices Aging Aggregation
```sql
SELECT invoices.*
FROM invoices
WHERE status = 'confirmed'
  AND due_date < :today
  AND amount_paid < total
ORDER BY due_date ASC;
```
- **Index Utilized**: `ix_invoices_status_due_date` composite index on `(status, due_date)`.
- **Optimization**: Isolates outstanding debts without table scans over historically paid or cancelled invoices.

### Query 3: Customer Autocomplete Search
```sql
SELECT customers.*
FROM customers
WHERE lower(name) LIKE :query
ORDER BY name ASC
LIMIT 50;
```
- **Index Utilized**: `ix_customers_lower_name` index on `name`.
