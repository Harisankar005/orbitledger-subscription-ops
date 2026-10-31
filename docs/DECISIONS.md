# Architecture & Business Logic Decisions (ADRs)

### D-001: Plan Recurring Base Fee vs Product Lines
- **Context**: In SaaS subscription billing, subscriptions often comprise a base fee for the tier/service plus metered seats or product addons.
- **Decision**: Plan `price` is modeled as the base recurring fee and is automatically generated as a line item of source `plan_fee` on every invoice for that period. Product lines represent seats, addon modules, and variants.
- **Consequence**: Clear itemization on customer invoices, transparent tax calculation per component, and simplified revenue accounting.

### D-002: Minimum Quantity Definition
- **Context**: Plans have a `min_quantity` attribute.
- **Decision**: `min_quantity` is defined as the minimum sum of quantities across all product/addon lines attached to the subscription.
- **Consequence**: Enforced strictly when transitioning a subscription out of `draft` status. Subscriptions failing this requirement cannot be quoted or confirmed.

### D-003: Billing Engine Proration Policy
- **Context**: Handling mid-period cancellations and renewals.
- **Decision**: No mid-period proration. A period is billed in full if its start date falls on or before the subscription's `expiry_date`.
- **Consequence**: Deterministic and audit-friendly billing math without fractional cent ambiguity; clearly communicated to customers upfront.

### D-004: Discount Rule Stacking Policy
- **Context**: Multiple discount rules may simultaneously qualify on an invoice.
- **Decision**: 
  1. Product-scoped discounts: For each line item, evaluate all active eligible product rules and apply the **best single** discount (maximum monetary deduction).
  2. Subscription-scoped discounts: Evaluate all active eligible subscription rules against the post-line-discount subtotal and apply the **best single** discount.
  3. Total line discounts cannot exceed the line's taxable base amount, and total invoice discounts cannot exceed the pre-discount subtotal.
- **Consequence**: Prevents runaway compounding discounts while guaranteeing maximum savings for the customer without complex rule ordering conflicts.

### D-005: Database Dialect Compatibility & Fallback
- **Context**: Judges and team members may run the codebase without Docker or local PostgreSQL daemon.
- **Decision**: Use portable SQLAlchemy 2.0 ORM construct patterns. PostgreSQL optimizations (row locks with `SKIP LOCKED`, advisory locks for worker synchronization) are guarded with `if session.bind.dialect.name == "postgresql"`. SQLite fallback is fully supported with WAL mode and row-level safety.
- **Consequence**: Zero-friction setup on any developer laptop or evaluation machine while offering full enterprise concurrency on PostgreSQL.
