import asyncio
import time
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy.exc import IntegrityError

from app.clock import clock
from app.config import settings
from app.db import SessionLocal
from app.events import broadcaster
from app.models.billing import (
    AppliedDiscount,
    DiscountRule,
    Invoice,
    InvoiceLine,
)
from app.models.subscription import Subscription
from app.schemas.billing import BillingRunFailedItem, BillingRunResponse
from app.services.audit import log_audit
from app.services.discount import (
    evaluate_product_line_discount,
    evaluate_subscription_discount,
    try_claim_discount_usage,
)
from app.services.numbering import generate_next_number
from app.services.tax import (
    calculate_tax_amount,
    compute_prorated_discount_shares,
    round_money,
)


def get_period_delta(billing_period: str, count: int = 1) -> relativedelta:
    """Return period delta offset from billing anchor (prevents date drift on month-end anchors)."""
    if billing_period == "daily":
        return relativedelta(days=count)
    if billing_period == "weekly":
        return relativedelta(weeks=count)
    if billing_period == "monthly":
        return relativedelta(months=count)
    if billing_period == "yearly":
        return relativedelta(years=count)
    return relativedelta(months=count)


def run_billing_engine(
    as_of_date: Optional[date] = None,
    dry_run: bool = False,
    actor_id: Optional[int] = None,
    request_id: Optional[str] = None,
) -> BillingRunResponse:
    """Algorithm billing.run(as_of_date, dry_run=False) per PLAN.md 5.4.

    Batched processing, anchor-based period math, per-subscription transaction isolation,
    catching up missed periods, idempotent guarded by UNIQUE(subscription_id, period_start).
    """
    start_time = time.perf_counter()
    target_date = as_of_date or clock.today()

    created_count = 0
    skipped_already_billed = 0
    skipped_not_due = 0
    remaining_due = 0
    failed_items: List[BillingRunFailedItem] = []

    with SessionLocal() as db_rules:
        active_discounts = (
            db_rules.query(DiscountRule)
            .filter(
                DiscountRule.is_active.is_(True),
                DiscountRule.start_date <= target_date,
                DiscountRule.end_date >= target_date,
            )
            .all()
        )

    # Read due subscriptions
    with SessionLocal() as read_session:
        query = (
            read_session.query(Subscription)
            .filter(
                Subscription.status == "active",
                Subscription.next_invoice_date <= target_date,
                Subscription.next_invoice_date <= Subscription.expiry_date,
            )
            .order_by(Subscription.id.asc())
        )

        if read_session.bind and read_session.bind.dialect.name == "postgresql":
            # Concurrency safety: Skip locked to avoid collision with concurrent worker runs
            query = query.with_for_update(skip_locked=True)

        due_subs = query.all()
        sub_ids = [s.id for s in due_subs]

    # Process each due subscription in its own discrete transaction
    for sub_id in sub_ids:
        with SessionLocal() as db:
            sub = db.query(Subscription).filter(Subscription.id == sub_id).first()
            if not sub:
                continue

            try:
                billed_for_sub = 0
                # Catch up missed periods
                while sub.next_invoice_date <= target_date and sub.next_invoice_date <= sub.expiry_date:
                    if billed_for_sub >= settings.MAX_CATCHUP_PERIODS:
                        # Cap reached: count remaining periods that stay due
                        anchor = sub.billing_anchor
                        period_unit = sub.plan.billing_period
                        periods = sub.periods_billed
                        curr_due = sub.next_invoice_date
                        while curr_due <= target_date and curr_due <= sub.expiry_date:
                            remaining_due += 1
                            periods += 1
                            curr_due = anchor + get_period_delta(period_unit, periods)
                        break
                    anchor = sub.billing_anchor
                    periods_billed = sub.periods_billed
                    period_unit = sub.plan.billing_period

                    period_start = anchor + get_period_delta(period_unit, periods_billed)
                    period_end = (anchor + get_period_delta(period_unit, periods_billed + 1)) - timedelta(days=1)

                    # Check if already billed
                    existing = (
                        db.query(Invoice)
                        .filter(
                            Invoice.subscription_id == sub.id,
                            Invoice.period_start == period_start,
                        )
                        .first()
                    )
                    if existing:
                        skipped_already_billed += 1
                        sub.periods_billed += 1
                        sub.next_invoice_date = anchor + get_period_delta(period_unit, sub.periods_billed)
                        if not dry_run:
                            db.commit()
                        continue

                    if dry_run:
                        created_count += 1
                        billed_for_sub += 1
                        sub.periods_billed += 1
                        sub.next_invoice_date = anchor + get_period_delta(period_unit, sub.periods_billed)
                        continue

                    # Build invoice lines
                    applied_discounts_to_add: List[AppliedDiscount] = []
                    subtotal = Decimal("0.00")
                    line_discount_total = Decimal("0.00")

                    # 1. Plan Base Fee Line Item (Decision D-001)
                    plan_tax = sub.plan.default_tax
                    plan_tax_id = plan_tax.id if plan_tax else None
                    plan_gross = sub.plan.price
                    subtotal += plan_gross
                    plan_net = plan_gross

                    # 2. Product & Addon Lines from Subscription
                    total_product_quantity = 0
                    prod_line_data = []
                    for s_line in sub.lines:
                        total_product_quantity += s_line.quantity
                        subtotal += s_line.amount

                        # Evaluate product discount (D-004)
                        line_disc_amount = Decimal("0.00")
                        prod_disc_match = evaluate_product_line_discount(
                            db=db,
                            product_id=s_line.product_id,
                            quantity=s_line.quantity,
                            line_amount=s_line.amount,
                            as_of_date=target_date,
                            preloaded_rules=active_discounts,
                        )

                        if prod_disc_match and not dry_run:
                            disc_rule, ded_amount = prod_disc_match
                            if try_claim_discount_usage(db, disc_rule.id):
                                line_disc_amount = ded_amount
                                applied_disc = AppliedDiscount(
                                    discount_rule_id=disc_rule.id,
                                    amount=ded_amount,
                                )
                                applied_discounts_to_add.append(applied_disc)

                        line_discount_total += line_disc_amount
                        line_net = max(Decimal("0.00"), s_line.amount - line_disc_amount)
                        prod_line_data.append((s_line, line_disc_amount, line_net))

                    # 3. Subscription-Scoped Discount on Post-Line Subtotal (D-004)
                    post_line_subtotal = subtotal - line_discount_total
                    sub_disc_match = evaluate_subscription_discount(
                        db=db,
                        subscription_id=sub.id,
                        total_quantity=total_product_quantity,
                        preloaded_rules=active_discounts,
                        post_line_subtotal=post_line_subtotal,
                        as_of_date=target_date,
                    )
                    sub_disc_amount = Decimal("0.00")
                    if sub_disc_match and not dry_run:
                        disc_rule, ded_amount = sub_disc_match
                        if try_claim_discount_usage(db, disc_rule.id):
                            sub_disc_amount = ded_amount
                            applied_disc = AppliedDiscount(
                                discount_rule_id=disc_rule.id,
                                amount=ded_amount,
                            )
                            applied_discounts_to_add.append(applied_disc)

                    discount_total = line_discount_total + sub_disc_amount

                    # 4. Prorate invoice-level discount across lines to reduce taxable base (D-006)
                    all_nets = [plan_net] + [item[2] for item in prod_line_data]
                    prorated_shares = compute_prorated_discount_shares(all_nets, sub_disc_amount)

                    # Compute plan line tax and line_total
                    plan_share = prorated_shares[0]
                    plan_taxable = max(Decimal("0.00"), round_money(plan_net - plan_share))
                    plan_tax_amount = calculate_tax_amount(plan_tax, plan_taxable, 1)
                    plan_line_total = round_money(plan_taxable + plan_tax_amount)

                    plan_line = InvoiceLine(
                        source="plan_fee",
                        product_id=None,
                        description=f"{sub.plan.name} - Recurring Base Fee",
                        quantity=1,
                        unit_price=sub.plan.price,
                        discount_amount=Decimal("0.00"),
                        tax_id=plan_tax_id,
                        tax_amount=plan_tax_amount,
                        line_total=plan_line_total,
                    )
                    invoice_lines_to_add: List[InvoiceLine] = [plan_line]
                    tax_total = plan_tax_amount

                    # Compute product lines tax and line_total
                    for idx, (s_line, line_disc_amount, line_net) in enumerate(prod_line_data, start=1):
                        l_share = prorated_shares[idx]
                        l_taxable = max(Decimal("0.00"), round_money(line_net - l_share))
                        line_tax_amt = calculate_tax_amount(s_line.tax, l_taxable, s_line.quantity)
                        tax_total += line_tax_amt
                        line_total = round_money(l_taxable + line_tax_amt)

                        inv_line = InvoiceLine(
                            source="product",
                            product_id=s_line.product_id,
                            description=s_line.description,
                            quantity=s_line.quantity,
                            unit_price=s_line.unit_price,
                            discount_amount=line_disc_amount,
                            tax_id=s_line.tax_id,
                            tax_amount=line_tax_amt,
                            line_total=line_total,
                        )
                        invoice_lines_to_add.append(inv_line)

                    total = round_money(subtotal - discount_total + tax_total)

                    # Issue invoice number & compute due date
                    if not dry_run:
                        inv_number = generate_next_number(db, "INV")
                    else:
                        inv_number = f"INV-DRY-{sub.id}"
                    payment_term_days = sub.payment_term.days if sub.payment_term else 0
                    due_date = target_date + timedelta(days=payment_term_days)

                    invoice = Invoice(
                        number=inv_number,
                        subscription_id=sub.id,
                        customer_id=sub.customer_id,
                        period_start=period_start,
                        period_end=period_end,
                        issue_date=target_date,
                        due_date=due_date,
                        status="draft",
                        subtotal=round_money(subtotal),
                        discount_total=round_money(discount_total),
                        tax_total=round_money(tax_total),
                        total=round_money(total),
                        amount_paid=Decimal("0.00"),
                        currency=sub.currency,
                        version=1,
                    )

                    if not dry_run:
                        db.add(invoice)
                        db.flush()

                        for il in invoice_lines_to_add:
                            il.invoice_id = invoice.id
                            db.add(il)

                        for ad in applied_discounts_to_add:
                            ad.invoice_id = invoice.id
                            db.add(ad)

                        # Increment subscription periods_billed and advance next_invoice_date
                        sub.periods_billed += 1
                        sub.next_invoice_date = anchor + get_period_delta(period_unit, sub.periods_billed)
                        sub.version += 1

                        log_audit(
                            db=db,
                            actor_id=actor_id,
                            action="invoice.generated",
                            entity_type="invoice",
                            entity_id=invoice.id,
                            after={"number": invoice.number, "total": str(invoice.total), "subscription_id": sub.id},
                            request_id=request_id,
                        )

                        try:
                            db.commit()
                            created_count += 1
                            billed_for_sub += 1
                        except IntegrityError:
                            # UNIQUE(subscription_id, period_start) constraint caught race condition
                            db.rollback()
                            skipped_already_billed += 1
                            break
                    else:
                        # In dry run, simply count
                        created_count += 1
                        billed_for_sub += 1
                        sub.periods_billed += 1
                        sub.next_invoice_date = anchor + get_period_delta(period_unit, sub.periods_billed)

            except Exception as exc:
                db.rollback()
                failed_items.append(
                    BillingRunFailedItem(
                        subscription_id=sub.id,
                        subscription_number=sub.number,
                        reason=str(exc),
                    )
                )

    duration_ms = int((time.perf_counter() - start_time) * 1000)

    # Broadcast live SSE update if invoices were created
    if created_count > 0 and not dry_run:
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(
                broadcaster.broadcast(
                    "billing.completed",
                    {"created": created_count, "as_of_date": target_date.isoformat()},
                )
            )
        except RuntimeError:
            pass

    return BillingRunResponse(
        created=created_count,
        skipped_already_billed=skipped_already_billed,
        skipped_not_due=skipped_not_due,
        remaining_due=remaining_due,
        failed=failed_items,
        duration_ms=duration_ms,
        dry_run=dry_run,
        as_of_date=target_date,
    )
