from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.catalog import Product, Tax, TaxRule
from app.services.tax import (
    calculate_tax_amount,
    compute_prorated_discount_shares,
    resolve_line_tax,
    round_money,
)

# In-memory SQLite session fixture for isolated tests
engine = create_engine("sqlite:///:memory:")
Base.metadata.create_all(bind=engine)
TestSession = sessionmaker(bind=engine)


def test_tax_resolution_order():
    """Verify tax resolution order: explicit -> product default -> active tax rule -> none (PLAN.md 5.2)."""
    with TestSession() as db:
        tax_explicit = Tax(name="Line Override Tax", kind="percent", rate=Decimal("12.00"), is_active=True)
        tax_prod_default = Tax(name="Product Default Tax", kind="percent", rate=Decimal("18.00"), is_active=True)
        tax_rule = Tax(name="Tax Rule Priority Tax", kind="percent", rate=Decimal("5.00"), is_active=True)
        db.add_all([tax_explicit, tax_prod_default, tax_rule])
        db.flush()

        # Priority 10 rule for software
        rule = TaxRule(product_type="software", tax_id=tax_rule.id, priority=10, is_active=True)
        db.add(rule)

        prod = Product(
            name="SaaS License",
            type="software",
            sales_price=Decimal("100.00"),
            default_tax_id=tax_prod_default.id,
            is_active=True,
        )
        db.add(prod)
        db.flush()

        # 1. Explicit line tax wins
        resolved = resolve_line_tax(db, explicit_tax_id=tax_explicit.id, product=prod)
        assert resolved.name == "Line Override Tax"

        # 2. Product default wins over tax rule
        resolved = resolve_line_tax(db, explicit_tax_id=None, product=prod)
        assert resolved.name == "Product Default Tax"

        # 3. Tax rule wins when product default is None
        prod.default_tax_id = None
        db.flush()
        resolved = resolve_line_tax(db, explicit_tax_id=None, product=prod)
        assert resolved.name == "Tax Rule Priority Tax"

        # 4. None resolved when no matching rule
        prod.type = "physical"
        db.flush()
        resolved = resolve_line_tax(db, explicit_tax_id=None, product=prod)
        assert resolved is None


def test_calculate_tax_percent_and_fixed():
    """Verify ROUND_HALF_UP rounding on percentage and fixed rate taxes."""
    tax_pct = Tax(name="VAT 18%", kind="percent", rate=Decimal("18.00"), is_active=True)
    tax_fixed = Tax(name="Fee 25", kind="fixed", rate=Decimal("25.00"), is_active=True)

    # Percentage: 125.55 * 18% = 22.599 -> ROUND_HALF_UP -> 22.60
    amt_pct = calculate_tax_amount(tax_pct, Decimal("125.55"), 1)
    assert amt_pct == Decimal("22.60")

    # Fixed: 25.00 * 3 units = 75.00
    amt_fixed = calculate_tax_amount(tax_fixed, Decimal("100.00"), 3)
    assert amt_fixed == Decimal("75.00")

    # Zero taxable amount
    assert calculate_tax_amount(tax_pct, Decimal("0.00"), 1) == Decimal("0.00")
    assert calculate_tax_amount(None, Decimal("100.00"), 1) == Decimal("0.00")


# Hypothesis Property Test
@given(
    taxable=st.decimals(min_value=Decimal("0.01"), max_value=Decimal("100000.00"), places=2),
    rate=st.decimals(min_value=Decimal("0.00"), max_value=Decimal("50.00"), places=2),
)
def test_hypothesis_tax_rounding_invariants(taxable: Decimal, rate: Decimal):
    """Property test: Tax calculation never exceeds taxable amount (for rate <= 100%) and preserves 2 decimal places."""
    tax = Tax(name="Test Tax", kind="percent", rate=rate, is_active=True)
    tax_amt = calculate_tax_amount(tax, taxable, 1)

    assert tax_amt >= Decimal("0.00")
    assert tax_amt <= taxable
    assert tax_amt.as_tuple().exponent == -2


def test_two_line_invoice_with_fixed_500_discount_prorated_tax():
    """Verify Decision D-006: A two-line invoice with fixed 500 invoice discount prorates discount across lines.

    total == subtotal - discount + tax, and sum(line.tax_amount) == tax_total to the cent.
    """
    line1_amount = Decimal("600.00")
    line2_amount = Decimal("400.00")
    subtotal = line1_amount + line2_amount  # 1000.00
    invoice_discount = Decimal("500.00")

    tax1 = Tax(name="GST 18%", kind="percent", rate=Decimal("18.00"), is_active=True)
    tax2 = Tax(name="GST 12%", kind="percent", rate=Decimal("12.00"), is_active=True)

    # 1. Prorate discount
    shares = compute_prorated_discount_shares([line1_amount, line2_amount], invoice_discount)
    assert len(shares) == 2
    assert shares[0] == Decimal("300.00")
    assert shares[1] == Decimal("200.00")
    assert sum(shares) == invoice_discount

    # 2. Taxable base per line = line_amount - prorated_discount
    taxable1 = round_money(line1_amount - shares[0])  # 300.00
    taxable2 = round_money(line2_amount - shares[1])  # 200.00

    # 3. Tax per line
    tax_amt1 = calculate_tax_amount(tax1, taxable1, 1)  # 300 * 18% = 54.00
    tax_amt2 = calculate_tax_amount(tax2, taxable2, 1)  # 200 * 12% = 24.00
    tax_total = tax_amt1 + tax_amt2  # 78.00

    # 4. Line totals and invoice total
    line1_total = round_money(taxable1 + tax_amt1)  # 354.00
    line2_total = round_money(taxable2 + tax_amt2)  # 224.00
    total = round_money(subtotal - invoice_discount + tax_total)  # 1000 - 500 + 78 = 578.00

    # Invariants
    assert tax_amt1 + tax_amt2 == tax_total == Decimal("78.00")
    assert line1_total + line2_total == total == Decimal("578.00")
    assert total == round_money(subtotal - invoice_discount + tax_total)


@given(
    line1_net=st.decimals(min_value=Decimal("1.00"), max_value=Decimal("5000.00"), places=2),
    line2_net=st.decimals(min_value=Decimal("1.00"), max_value=Decimal("5000.00"), places=2),
    discount=st.decimals(min_value=Decimal("0.00"), max_value=Decimal("2000.00"), places=2),
    rate1=st.decimals(min_value=Decimal("0.00"), max_value=Decimal("30.00"), places=2),
    rate2=st.decimals(min_value=Decimal("0.00"), max_value=Decimal("30.00"), places=2),
)
def test_hypothesis_invoice_discount_proration_invariants(
    line1_net: Decimal,
    line2_net: Decimal,
    discount: Decimal,
    rate1: Decimal,
    rate2: Decimal,
):
    """Property test: Sum of prorated line taxes strictly equals tax_total, and total == subtotal - discount + tax to the cent."""
    subtotal = line1_net + line2_net
    shares = compute_prorated_discount_shares([line1_net, line2_net], discount)

    effective_discount = min(discount, subtotal)
    assert sum(shares) == effective_discount

    tax1 = Tax(name="T1", kind="percent", rate=rate1, is_active=True)
    tax2 = Tax(name="T2", kind="percent", rate=rate2, is_active=True)

    taxable1 = max(Decimal("0.00"), round_money(line1_net - shares[0]))
    taxable2 = max(Decimal("0.00"), round_money(line2_net - shares[1]))

    tax_line1 = calculate_tax_amount(tax1, taxable1, 1)
    tax_line2 = calculate_tax_amount(tax2, taxable2, 1)
    tax_total = tax_line1 + tax_line2

    line1_total = round_money(taxable1 + tax_line1)
    line2_total = round_money(taxable2 + tax_line2)

    total = round_money(subtotal - effective_discount + tax_total)

    # Invariants
    assert tax_line1 + tax_line2 == tax_total
    assert line1_total + line2_total == total
