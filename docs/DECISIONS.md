# Architecture and business logic decisions

### D-001: recurring base fee and product lines
- Context. Subscriptions combine a recurring tier fee with seat counts and add-on products.
- Decision. Plan price represents the recurring base fee and appears as a line item on each periodic invoice. Product lines represent seats, modules, and variants.
- Consequence. Invoices separate the base tier charge from variable product lines with clear line-item tax calculation.

### D-002: minimum quantity definition
- Context. Plans include a minimum quantity requirement.
- Decision. Minimum quantity is the required sum of quantities across all attached product lines.
- Consequence. Subscriptions must meet this total quantity before leaving the Draft status.

### D-003: billing proration policy
- Context. Handling mid-cycle cancellations and renewals.
- Decision. No partial period proration. The engine bills a cycle in full if its start date falls on or before the subscription expiration date.
- Consequence. Deterministic billing math without fractional day calculations.

### D-004: discount rule stacking policy
- Context. Multiple promotional discounts may qualify on a single invoice.
- Decision.
  1. Product discounts: For each line item, evaluate active eligible product rules and apply the single discount with the largest monetary deduction.
  2. Subscription discounts: Evaluate eligible subscription-level rules against the post-line subtotal and apply the single largest discount.
  3. Limits: Line discounts cannot exceed the line total, and order discounts cannot exceed the pre-discount total.
- Consequence. Avoids compounding discounts while applying the largest single deduction for the customer.

### D-005: database dialect compatibility and fallback
- Context. Local development and grading may run without PostgreSQL installed.
- Decision. Write queries using portable SQLAlchemy 2.0 ORM expressions. Guard PostgreSQL-specific statements (`SKIP LOCKED` and advisory locks) behind database dialect checks.
- Consequence. Developers can run the application on SQLite with WAL mode while production deployments use PostgreSQL row locks.
