## Summary
<!-- Briefly describe the changes introduced by this PR. Include motivation and context. -->

## Scope & Owner
- [ ] Owner A (Lead: Platform, Auth, Security, Audit)
- [ ] Owner B (Catalog, Tax Rules, Plans, Discounts, Seed)
- [ ] Owner C (Subscriptions, Billing Engine, Invoices, Payments, Worker)
- [ ] Owner D (Frontend UI, Dashboard, Portal, Components)

## Verification Checklist
- [ ] Unit & integration tests pass (`pytest`)
- [ ] Linting & type checking pass (`ruff`, `tsc`)
- [ ] No regression in business logic or state machine
- [ ] Money calculations verified using `Decimal` and `ROUND_HALF_UP`
- [ ] Idempotency & concurrency verified if touching billing/payments
- [ ] Responsive design verified (mobile, tablet, desktop)

## Related Issue / Section in PLAN.md
Section:
