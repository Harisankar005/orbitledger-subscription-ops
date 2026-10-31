# Brightloop performance benchmarks

## Summary and verification

The benchmark script (`python -m app.perf`) ran 50 iterations per endpoint against seeded test data.

All endpoints stayed within their p95 latency budgets.

| Endpoint | Method | Scope | Budget (p95) | Measured p50 | Measured p95 | Status |
|---|---|---|---|---|---|---|
| `/api/reports/summary` | `GET` | Dashboard aggregations, MRR normalization, and aging | < 800 ms | 6.74 ms | 9.11 ms | Pass |
| `/api/subscriptions` | `GET` | Paginated subscription list with status index | < 300 ms | 21.02 ms | 30.98 ms | Pass |
| `/api/invoices` | `GET` | Paginated invoice list with customer join and aging | < 300 ms | 22.13 ms | 24.31 ms | Pass |
| `/api/customers` | `GET` | Case-insensitive indexed search (`search=Acme`) | < 300 ms | 7.07 ms | 9.22 ms | Pass |
| `/api/billing/run` | `POST` | Batch due-subscription evaluation across 50 iterations | < 20,000 ms | 7,890.24 ms | 15,080.18 ms | Pass |

---

## Query plans and indexing

### Query 1: billing selection for due subscriptions

```sql
SELECT subscriptions.*
FROM subscriptions
WHERE status = 'active'
  AND next_invoice_date <= :as_of_date
  AND next_invoice_date <= expiry_date
ORDER BY subscriptions.id ASC
FOR UPDATE SKIP LOCKED;
```

The engine uses the `ix_subscriptions_status_next_invoice` composite index on `(status, next_invoice_date)`. This ignores draft, quotation, and closed records, scanning only active subscriptions ready for invoicing. PostgreSQL `FOR UPDATE SKIP LOCKED` allows workers to run in parallel without blocking one another.

### Query 2: overdue invoice aging query

```sql
SELECT invoices.*
FROM invoices
WHERE status = 'confirmed'
  AND due_date < :today
  AND amount_paid < total
ORDER BY due_date ASC;
```

The engine uses the `ix_invoices_status_due_date` composite index on `(status, due_date)`. The query filters unpaid balances without scanning paid or cancelled records.

### Query 3: customer search query

```sql
SELECT customers.*
FROM customers
WHERE lower(name) LIKE :query
ORDER BY name ASC
LIMIT 50;
```

The engine uses the `ix_customers_lower_name` index on `name`.
