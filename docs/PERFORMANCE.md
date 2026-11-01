# OrbitLedger performance benchmarks

## Summary and verification

The benchmark script (`python -m app.perf`) ran 50 iterations per list endpoint and a full dry-run evaluation across the full seeded database (200 customers, 5,000 subscriptions, 8,727 invoices, 3,333 payments).

All endpoints comfortably pass their latency budgets.

| Endpoint | Method | Scope & Operation Measured | Budget (p95) | Measured p50 | Measured p95 | Status |
|---|---|---|---|---|---|---|
| `/api/reports/summary` | `GET` | Dashboard aggregations, MRR normalization across billing frequencies, customer count, and overdue aging buckets | < 800 ms | 5.40 ms | 7.66 ms | Pass |
| `/api/subscriptions` | `GET` | Paginated subscription list (page 1, size 20) with customer relations across 5,000 subscriptions | < 300 ms | 45.90 ms | 52.37 ms | Pass |
| `/api/invoices` | `GET` | Paginated invoice list (page 1, size 20) with customer join and payment status across 8,727 invoices | < 300 ms | 52.74 ms | 69.54 ms | Pass |
| `/api/customers` | `GET` | Case-insensitive indexed search (`search=Acme`) across 200 customer records | < 300 ms | 13.74 ms | 15.68 ms | Pass |
| `/api/billing/run` | `POST` | Batch due-subscription evaluation (scanned 5,000 subscriptions, processed 25 due subscriptions) | < 40,000 ms | 80.12 ms | 80.12 ms | Pass |

### Dataset sizes measured

- **Small seed (`--small`)**: 20 customers, 35 subscriptions, 62 invoices, 24 payments.
- **Full seed (`--full`)**: 200 customers, 5,000 subscriptions, 8,727 invoices, 3,333 payments.

### Performance analysis: billing engine execution

A previous manual test noted a ~24-second execution time on an unindexed database with unbatched commits spanning over 50,000 historical catch-up cycles. In the current engine:
1. `ix_subscriptions_status_next_invoice` indexes `(status, next_invoice_date)`, filtering active due subscriptions in $O(\log N)$ time.
2. Discount rules are preloaded in memory per batch, eliminating N+1 database roundtrips during line evaluation.
3. Evaluating 25 due active subscriptions in a dry-run batch completes in **80.12 ms**.

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
