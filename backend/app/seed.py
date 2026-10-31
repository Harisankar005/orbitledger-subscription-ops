import argparse
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import List

from dateutil.relativedelta import relativedelta

from app.clock import clock
from app.db import SessionLocal, engine
from app.models import Base
from app.models.billing import (
    DiscountRule,
    Invoice,
    InvoiceLine,
    NumberCounter,
    Payment,
)
from app.models.catalog import (
    PaymentTerm,
    Plan,
    Product,
    ProductVariant,
    QuotationTemplate,
    QuotationTemplateLine,
    Tax,
    TaxRule,
)
from app.models.identity import Customer, User
from app.models.subscription import (
    Subscription,
    SubscriptionLine,
    SubscriptionStatusHistory,
)
from app.security import hash_password
from app.services.billing import get_period_delta
from app.services.tax import round_money


def seed_database(small: bool = True):
    """Deterministic, idempotent seed data generator (PLAN.md Section 10)."""
    random.seed(42)  # Deterministic seed

    # Reset schema for clean deterministic seed
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        print("[SEED] Seeding OrbitLedger database (small=" + str(small) + ")...")

        # 1. Number Counters
        db.add(NumberCounter(name="SUB", next_value=1))
        db.add(NumberCounter(name="INV", next_value=1))
        db.flush()

        # 2. Users (Admin, Staff, Customer Portal)
        admin = User(
            email="admin@brightloop.test",
            password_hash=hash_password("Admin@1234"),
            role="admin",
            full_name="B. Harisankar (Admin)",
            is_active=True,
        )
        staff1 = User(
            email="staff1@brightloop.test",
            password_hash=hash_password("Staff@1234"),
            role="staff",
            full_name="Rohan S (Staff)",
            is_active=True,
        )
        staff2 = User(
            email="staff2@brightloop.test",
            password_hash=hash_password("Staff@1234"),
            role="staff",
            full_name="Michael Scott (Staff)",
            is_active=True,
        )
        portal_user = User(
            email="customer@brightloop.test",
            password_hash=hash_password("Customer@1234"),
            role="customer",
            full_name="Wayne Enterprises (Bruce Wayne)",
            is_active=True,
        )
        db.add_all([admin, staff1, staff2, portal_user])
        db.flush()

        # 3. Taxes
        tax_gst_18 = Tax(name="GST 18%", kind="percent", rate=Decimal("18.00"), is_active=True)
        tax_gst_5 = Tax(name="GST 5%", kind="percent", rate=Decimal("5.00"), is_active=True)
        tax_fixed = Tax(name="Fixed Regulatory Fee", kind="fixed", rate=Decimal("50.00"), is_active=True)
        db.add_all([tax_gst_18, tax_gst_5, tax_fixed])
        db.flush()

        # 4. Tax Rules
        rule_software = TaxRule(product_type="software", tax_id=tax_gst_18.id, priority=20, is_active=True)
        rule_physical = TaxRule(product_type="physical", tax_id=tax_gst_5.id, priority=15, is_active=True)
        rule_service = TaxRule(product_type="service", tax_id=tax_gst_18.id, priority=10, is_active=True)
        db.add_all([rule_software, rule_physical, rule_service])
        db.flush()

        # 5. Payment Terms
        term_immediate = PaymentTerm(name="Immediate Payment", days=0)
        term_15 = PaymentTerm(name="Net 15 Days", days=15)
        term_30 = PaymentTerm(name="Net 30 Days", days=30)
        db.add_all([term_immediate, term_15, term_30])
        db.flush()

        # 6. Products & Variants (including Brand=Odoo +560)
        prod_erp = Product(
            name="OrbitLedger Cloud ERP Seat",
            type="software",
            sales_price=Decimal("1200.00"),
            cost_price=Decimal("300.00"),
            default_tax_id=tax_gst_18.id,
            is_active=True,
        )
        prod_addon = Product(
            name="Advanced Analytics Add-on",
            type="addon",
            sales_price=Decimal("450.00"),
            cost_price=Decimal("100.00"),
            default_tax_id=tax_gst_18.id,
            is_active=True,
        )
        prod_onboarding = Product(
            name="White-Glove Onboarding",
            type="service",
            sales_price=Decimal("5000.00"),
            cost_price=Decimal("2000.00"),
            default_tax_id=tax_gst_18.id,
            is_active=True,
        )
        prod_hw = Product(
            name="IoT Gateway Hardware",
            type="physical",
            sales_price=Decimal("8500.00"),
            cost_price=Decimal("5000.00"),
            default_tax_id=tax_gst_5.id,
            is_active=True,
        )
        prod_support = Product(
            name="24/7 Dedicated Support",
            type="service",
            sales_price=Decimal("2500.00"),
            cost_price=Decimal("800.00"),
            default_tax_id=tax_gst_18.id,
            is_active=True,
        )
        db.add_all([prod_erp, prod_addon, prod_onboarding, prod_hw, prod_support])
        db.flush()

        # Variants (Brand=Odoo extra_price = +560.00)
        var_odoo = ProductVariant(
            product_id=prod_erp.id,
            attribute="Brand",
            value="Odoo",
            extra_price=Decimal("560.00"),
        )
        var_standard = ProductVariant(
            product_id=prod_erp.id,
            attribute="Brand",
            value="Standard",
            extra_price=Decimal("0.00"),
        )
        var_hw_pro = ProductVariant(
            product_id=prod_hw.id,
            attribute="Edition",
            value="Pro Enterprise",
            extra_price=Decimal("1500.00"),
        )
        db.add_all([var_odoo, var_standard, var_hw_pro])
        db.flush()

        # 7. Plans (All 4 periods, mix of flags)
        today = clock.today()
        from_date = today - timedelta(days=365)
        to_date = today + timedelta(days=730)

        plan_daily = Plan(
            name="Daily Flexible Pass",
            price=Decimal("99.00"),
            billing_period="daily",
            min_quantity=1,
            available_from=from_date,
            available_to=to_date,
            default_tax_id=tax_gst_18.id,
            auto_close_on_end=True,
            allow_early_close=True,
            allow_pause=True,
            allow_renew=True,
        )
        plan_weekly = Plan(
            name="Weekly Starter Tier",
            price=Decimal("499.00"),
            billing_period="weekly",
            min_quantity=2,
            available_from=from_date,
            available_to=to_date,
            default_tax_id=tax_gst_18.id,
            auto_close_on_end=False,
            allow_early_close=True,
            allow_pause=True,
            allow_renew=True,
        )
        plan_monthly = Plan(
            name="Professional Monthly",
            price=Decimal("1999.00"),
            billing_period="monthly",
            min_quantity=3,
            available_from=from_date,
            available_to=to_date,
            default_tax_id=tax_gst_18.id,
            auto_close_on_end=True,
            allow_early_close=True,
            allow_pause=True,
            allow_renew=True,
        )
        plan_strict_monthly = Plan(
            name="Fixed Annual Contract (Monthly Billed)",
            price=Decimal("1499.00"),
            billing_period="monthly",
            min_quantity=5,
            available_from=from_date,
            available_to=to_date,
            default_tax_id=tax_gst_18.id,
            auto_close_on_end=True,
            allow_early_close=False,  # Early close forbidden!
            allow_pause=False,       # Pause forbidden!
            allow_renew=True,
        )
        plan_yearly = Plan(
            name="Enterprise Yearly",
            price=Decimal("18999.00"),
            billing_period="yearly",
            min_quantity=10,
            available_from=from_date,
            available_to=to_date,
            default_tax_id=tax_gst_18.id,
            auto_close_on_end=False,
            allow_early_close=False,
            allow_pause=True,
            allow_renew=True,
        )
        plan_legacy = Plan(
            name="Legacy Archived Plan",
            price=Decimal("799.00"),
            billing_period="monthly",
            min_quantity=1,
            available_from=today - timedelta(days=400),
            available_to=today - timedelta(days=30),  # Expired plan
            default_tax_id=tax_gst_18.id,
            auto_close_on_end=True,
            allow_early_close=True,
            allow_pause=False,
            allow_renew=False,
        )
        db.add_all([plan_daily, plan_weekly, plan_monthly, plan_strict_monthly, plan_yearly, plan_legacy])
        db.flush()

        # 8. Quotation Templates
        tpl_standard = QuotationTemplate(
            name="Standard SaaS Onboarding Template",
            plan_id=plan_monthly.id,
            validity_days=30,
            payment_term_id=term_30.id,
            is_active=True,
        )
        tpl_enterprise = QuotationTemplate(
            name="Enterprise Multi-Seat Bundle",
            plan_id=plan_yearly.id,
            validity_days=45,
            payment_term_id=term_30.id,
            is_active=True,
        )
        db.add_all([tpl_standard, tpl_enterprise])
        db.flush()

        db.add(QuotationTemplateLine(template_id=tpl_standard.id, product_id=prod_erp.id, variant_id=var_odoo.id, quantity=5))
        db.add(QuotationTemplateLine(template_id=tpl_standard.id, product_id=prod_addon.id, quantity=3))
        db.add(QuotationTemplateLine(template_id=tpl_enterprise.id, product_id=prod_erp.id, variant_id=var_odoo.id, quantity=25))
        db.add(QuotationTemplateLine(template_id=tpl_enterprise.id, product_id=prod_support.id, quantity=1))
        db.flush()

        # 9. Discount Rules (PLAN.md 10: one expired, one nearly exhausted, one product-scoped, one subscription-scoped)
        disc_volume = DiscountRule(
            name="Volume 10% Seat Discount",
            kind="percent",
            value=Decimal("10.00"),
            min_purchase_amount=Decimal("5000.00"),
            min_quantity=5,
            start_date=today - timedelta(days=60),
            end_date=today + timedelta(days=120),
            usage_limit=100,
            used_count=4,
            scope="product",
            product_id=prod_erp.id,
            is_active=True,
        )
        disc_exhausted = DiscountRule(
            name="Early Bird Launch Promo (Near Exhausted)",
            kind="fixed",
            value=Decimal("500.00"),
            min_purchase_amount=Decimal("1000.00"),
            min_quantity=1,
            start_date=today - timedelta(days=30),
            end_date=today + timedelta(days=30),
            usage_limit=10,
            used_count=9,  # 9/10 used
            scope="subscription",
            is_active=True,
        )
        disc_expired = DiscountRule(
            name="Black Friday 2025 Special",
            kind="percent",
            value=Decimal("25.00"),
            min_purchase_amount=Decimal("2000.00"),
            min_quantity=1,
            start_date=today - timedelta(days=90),
            end_date=today - timedelta(days=10),  # Expired
            usage_limit=50,
            used_count=12,
            scope="subscription",
            is_active=True,
        )
        disc_enterprise_sub = DiscountRule(
            name="Enterprise Global 15% Waiver",
            kind="percent",
            value=Decimal("15.00"),
            min_purchase_amount=Decimal("15000.00"),
            min_quantity=10,
            start_date=today - timedelta(days=30),
            end_date=today + timedelta(days=180),
            usage_limit=None,
            used_count=2,
            scope="subscription",
            is_active=True,
        )
        db.add_all([disc_volume, disc_exhausted, disc_expired, disc_enterprise_sub])
        db.flush()

        # 10. Customers
        customer_count = 20 if small else 200
        customers = []

        # Portal demo customer linked to portal_user
        portal_customer = Customer(
            user_id=portal_user.id,
            name="Wayne Enterprises",
            email="customer@brightloop.test",
            phone="+91 98765 43210",
            company="Wayne Enterprises Global",
            billing_address="100 Gotham Plaza, Mumbai, Maharashtra 400001",
            tax_id="27AAAAA0000A1Z5",
        )
        db.add(portal_customer)
        customers.append(portal_customer)

        company_names = [
            "Acme Corp", "Stark Industries", "Cyberdyne Systems", "Globex Corporation",
            "Initech", "Umbrella Corp", "Massive Dynamic", "Hooli", "Pied Piper",
            "Weyland-Yutani", "Oscorp", "Tyrell Corporation", "Wonka Industries",
            "Soylent Corp", "Gekko & Co", "Dunder Mifflin", "Vandelay Industries",
            "Prestige Worldwide", "Bluth Company", "Sterling Cooper"
        ]

        for i in range(customer_count - 1):
            c_name = company_names[i % len(company_names)] + (f" #{i+1}" if i >= len(company_names) else "")
            c = Customer(
                name=f"{c_name} Lead",
                email=f"billing_{i+1}@{c_name.lower().replace(' ', '').replace('&', 'and')}test.com",
                phone=f"+91 98{i:08d}",
                company=c_name,
                billing_address=f"{101+i} Tech Business Park, Bangalore, Karnataka 560001",
                tax_id=f"29ABCDE{i:04d}F1Z5",
            )
            db.add(c)
            customers.append(c)
        db.flush()

        # 11. Subscriptions in every status (draft, quotation, confirmed, active, paused, closed)
        status_pool = ["active", "active", "active", "confirmed", "quotation", "paused", "closed", "draft"]
        plans_pool = [plan_monthly, plan_weekly, plan_strict_monthly, plan_yearly, plan_daily]

        sub_total_target = 35 if small else 5000
        created_subs: List[Subscription] = []

        for i in range(sub_total_target):
            cust = customers[i % len(customers)]
            p = plans_pool[i % len(plans_pool)]
            st = status_pool[i % len(status_pool)]

            # Stagger start dates and billing cycles using anchor-based relativedelta helper
            period_unit = p.billing_period
            past_periods = (i % 3) + 1
            sub_start = today - get_period_delta(period_unit, past_periods)
            sub_expiry = sub_start + relativedelta(years=2)

            due_stride = 8 if small else 200
            is_due = (i % due_stride == 0)

            if st == "active":
                periods_billed = past_periods if is_due else past_periods + 1
                next_inv = sub_start + get_period_delta(period_unit, periods_billed)
            elif st == "closed":
                periods_billed = past_periods
                next_inv = sub_start + get_period_delta(period_unit, periods_billed)
            elif st == "paused":
                periods_billed = past_periods + 1
                next_inv = sub_start + get_period_delta(period_unit, periods_billed)
            else:
                periods_billed = 0
                next_inv = sub_start

            sub = Subscription(
                number=f"SUB-{i+1:06d}",
                customer_id=cust.id,
                plan_id=p.id,
                status=st,
                start_date=sub_start,
                expiry_date=sub_expiry,
                payment_term_id=term_30.id,
                quotation_valid_until=today + timedelta(days=30) if st == "quotation" else None,
                billing_anchor=sub_start,
                periods_billed=periods_billed,
                next_invoice_date=next_inv,
                currency="INR",
                notes=f"Sample contract for {cust.name}",
                version=1,
            )
            db.add(sub)
            db.flush()

            # Lines
            var = var_odoo if i % 2 == 0 else var_standard
            qty = max(p.min_quantity, random.randint(3, 8))
            unit_price = round_money(prod_erp.sales_price + var.extra_price)
            line1 = SubscriptionLine(
                subscription_id=sub.id,
                product_id=prod_erp.id,
                variant_id=var.id,
                description=f"{prod_erp.name} ({var.attribute}: {var.value})",
                quantity=qty,
                unit_price=unit_price,
                tax_id=tax_gst_18.id,
                amount=round_money(unit_price * Decimal(qty)),
            )
            db.add(line1)

            if random.random() > 0.4:
                line2 = SubscriptionLine(
                    subscription_id=sub.id,
                    product_id=prod_addon.id,
                    description=prod_addon.name,
                    quantity=random.randint(1, 3),
                    unit_price=prod_addon.sales_price,
                    tax_id=tax_gst_18.id,
                    amount=round_money(prod_addon.sales_price * Decimal(2)),
                )
                db.add(line2)

            # Status history
            db.add(SubscriptionStatusHistory(
                subscription_id=sub.id,
                from_status="none",
                to_status=st,
                changed_by=admin.id,
                reason="System seed generation",
            ))
            created_subs.append(sub)

        db.flush()

        # 12. Invoices & Realistic Overdue Aging (PLAN.md 10)
        # Create invoices in draft, confirmed, paid, and realistic overdue buckets
        inv_idx = 1
        for s in created_subs:
            if s.status in ("active", "closed", "paused"):
                # Create historic invoices using same anchor-based period helper as billing.py
                period_unit = s.plan.billing_period
                for period_num in range(s.periods_billed):
                    p_start = s.billing_anchor + get_period_delta(period_unit, period_num)
                    p_end = (s.billing_anchor + get_period_delta(period_unit, period_num + 1)) - timedelta(days=1)
                    issue_dt = p_start

                    # Aging distribution:
                    # Some invoices due 45 days ago (bucket 31-60), some 15 days ago (bucket 1-30), some 75 days ago (61+)
                    due_dt = issue_dt + timedelta(days=15)

                    lines_subtotal = sum(li.amount for li in s.lines) + s.plan.price
                    tax_amt = round_money(lines_subtotal * Decimal("0.18"))
                    inv_total = lines_subtotal + tax_amt

                    # Status mix: Paid, Overdue, Partially Paid across aging buckets
                    is_overdue = due_dt < today
                    if period_num == 0 and (s.id % 3 != 0):
                        inv_status = "paid"
                        amt_paid = inv_total
                    elif is_overdue:
                        inv_status = "confirmed"
                        amt_paid = Decimal("0.00") if period_num % 2 == 0 else round_money(inv_total * Decimal("0.40"))
                    else:
                        inv_status = "confirmed"
                        amt_paid = Decimal("0.00")

                    inv = Invoice(
                        number=f"INV-{inv_idx:06d}",
                        subscription_id=s.id,
                        customer_id=s.customer_id,
                        period_start=p_start,
                        period_end=p_end,
                        issue_date=issue_dt,
                        due_date=due_dt,
                        status=inv_status,
                        subtotal=round_money(lines_subtotal),
                        discount_total=Decimal("0.00"),
                        tax_total=round_money(tax_amt),
                        total=round_money(inv_total),
                        amount_paid=round_money(amt_paid),
                        currency="INR",
                        sent_at=datetime.now(timezone.utc) - timedelta(days=10),
                        version=1,
                    )
                    db.add(inv)
                    db.flush()

                    # Add Plan Fee invoice line
                    db.add(InvoiceLine(
                        invoice_id=inv.id,
                        source="plan_fee",
                        description=f"{s.plan.name} - Base Fee",
                        quantity=1,
                        unit_price=s.plan.price,
                        discount_amount=Decimal("0.00"),
                        tax_id=tax_gst_18.id,
                        tax_amount=round_money(s.plan.price * Decimal("0.18")),
                        line_total=round_money(s.plan.price * Decimal("1.18")),
                    ))

                    # Add product lines
                    for sl in s.lines:
                        db.add(InvoiceLine(
                            invoice_id=inv.id,
                            source="product",
                            product_id=sl.product_id,
                            description=sl.description,
                            quantity=sl.quantity,
                            unit_price=sl.unit_price,
                            discount_amount=Decimal("0.00"),
                            tax_id=sl.tax_id,
                            tax_amount=round_money(sl.amount * Decimal("0.18")),
                            line_total=round_money(sl.amount * Decimal("1.18")),
                        ))

                    # 13. Payments
                    if amt_paid > 0:
                        methods = ["upi", "card", "bank_transfer", "cheque", "cash"]
                        db.add(Payment(
                            invoice_id=inv.id,
                            method=methods[inv_idx % len(methods)],
                            amount=round_money(amt_paid),
                            paid_on=min(today, due_dt + timedelta(days=2)),
                            note="Automated recurring settlement",
                            recorded_by=staff1.id,
                        ))

                    inv_idx += 1

            elif s.status in ("draft", "quotation") and s.id in (4, 8, 12, 16):
                # Create a few seeded draft invoices for draft/quotation subscriptions (proves draft exclusion)
                period_unit = s.plan.billing_period
                p_start = s.billing_anchor
                p_end = (s.billing_anchor + get_period_delta(period_unit, 1)) - timedelta(days=1)
                draft_subtotal = sum(li.amount for li in s.lines) + s.plan.price
                draft_tax = round_money(draft_subtotal * Decimal("0.18"))
                draft_total = round_money(draft_subtotal + draft_tax)
                draft_inv = Invoice(
                    number=f"INV-{inv_idx:06d}",
                    subscription_id=s.id,
                    customer_id=s.customer_id,
                    period_start=p_start,
                    period_end=p_end,
                    issue_date=today - timedelta(days=20),
                    due_date=today - timedelta(days=5),  # Due date is past, but status is draft!
                    status="draft",
                    subtotal=round_money(draft_subtotal),
                    discount_total=Decimal("0.00"),
                    tax_total=round_money(draft_tax),
                    total=round_money(draft_total),
                    amount_paid=Decimal("0.00"),
                    currency="INR",
                    version=1,
                )
                db.add(draft_inv)
                inv_idx += 1

        # UPDATE number_counters so that SUB.next_value = (highest numeric suffix among subscriptions.number) + 1
        # and INV.next_value = (highest numeric suffix among invoices.number) + 1
        max_sub = 0
        for (num,) in db.query(Subscription.number).all():
            suffix = num.split("-")[-1]
            if suffix.isdigit():
                max_sub = max(max_sub, int(suffix))

        max_inv = 0
        for (num,) in db.query(Invoice.number).all():
            suffix = num.split("-")[-1]
            if suffix.isdigit():
                max_inv = max(max_inv, int(suffix))

        sub_counter = db.query(NumberCounter).filter(NumberCounter.name == "SUB").first()
        if sub_counter:
            sub_counter.next_value = max_sub + 1
        else:
            db.add(NumberCounter(name="SUB", next_value=max_sub + 1))

        inv_counter = db.query(NumberCounter).filter(NumberCounter.name == "INV").first()
        if inv_counter:
            inv_counter.next_value = max_inv + 1
        else:
            db.add(NumberCounter(name="INV", next_value=max_inv + 1))

        db.commit()

        print("\n[SUCCESS] OrbitLedger Seed Data generated successfully!")
        print("=" * 60)
        print("DEMO LOGIN CREDENTIALS:")
        print("  - Admin:    admin@brightloop.test    / Admin@1234")
        print("  - Staff 1:  staff1@brightloop.test   / Staff@1234")
        print("  - Staff 2:  staff2@brightloop.test   / Staff@1234")
        print("  - Customer: customer@brightloop.test / Customer@1234")
        print("=" * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed OrbitLedger database")
    parser.add_argument("--small", action="store_true", default=True, help="Seed small demo dataset (default: True)")
    parser.add_argument("--full", action="store_true", help="Seed full scale performance dataset")
    args = parser.parse_args()

    is_small = not args.full
    seed_database(small=is_small)
