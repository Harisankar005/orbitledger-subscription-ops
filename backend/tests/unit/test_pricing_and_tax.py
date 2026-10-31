from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
from app.models.catalog import Product, Tax, TaxRule
from app.services.tax import calculate_tax_amount, resolve_line_tax

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
