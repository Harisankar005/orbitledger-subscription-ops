from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.catalog import Product, Tax, TaxRule

TWO_PLACES = Decimal("0.01")


def round_money(amount: Decimal) -> Decimal:
    """Round monetary amount using standard financial ROUND_HALF_UP to 2 decimal places."""
    return amount.quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def resolve_line_tax(
    db: Session,
    explicit_tax_id: Optional[int] = None,
    product: Optional[Product] = None,
) -> Optional[Tax]:
    """Resolve tax according to strict business precedence (PLAN.md 5.2):

    1. Explicit line tax (if provided)
    2. product.default_tax_id (if configured on product)
    3. Highest-priority active tax_rule matching product type (or global fallback rule where product_type IS NULL)
    4. None (tax-exempt)
    """
    if explicit_tax_id is not None:
        explicit_tax = db.query(Tax).filter(Tax.id == explicit_tax_id, Tax.is_active.is_(True)).first()
        if explicit_tax:
            return explicit_tax

    if product and product.default_tax_id is not None:
        prod_tax = db.query(Tax).filter(Tax.id == product.default_tax_id, Tax.is_active.is_(True)).first()
        if prod_tax:
            return prod_tax

    if product:
        # Match highest-priority tax rule matching product type, or global NULL product_type
        tax_rule = (
            db.query(TaxRule)
            .join(Tax, TaxRule.tax_id == Tax.id)
            .filter(
                TaxRule.is_active.is_(True),
                Tax.is_active.is_(True),
                (TaxRule.product_type == product.type) | (TaxRule.product_type.is_(None)),
            )
            .order_by(TaxRule.priority.desc())
            .first()
        )
        if tax_rule:
            return tax_rule.tax

    return None


def calculate_tax_amount(tax: Optional[Tax], taxable_amount: Decimal, quantity: int) -> Decimal:
    """Calculate tax for a line item using ROUND_HALF_UP.

    - percent: tax = taxable * rate / 100
    - fixed: tax = rate * quantity
    """
    if not tax or taxable_amount <= 0:
        return Decimal("0.00")

    if tax.kind == "percent":
        raw_tax = (taxable_amount * tax.rate) / Decimal("100")
    elif tax.kind == "fixed":
        raw_tax = tax.rate * Decimal(quantity)
    else:
        raw_tax = Decimal("0.00")

    return round_money(raw_tax)


def compute_prorated_discount_shares(
    net_amounts: list[Decimal],
    total_discount: Decimal,
) -> list[Decimal]:
    """Prorate an invoice-level discount across lines in proportion to their net amounts (Decision D-006).

    Each line's allocated share is rounded using standard ROUND_HALF_UP.
    Any penny discrepancy between the sum of line shares and total_discount is adjusted on the
    line with the largest net amount to ensure exact conservation of the discount total.
    """
    total_net = sum(net_amounts)
    if total_net <= Decimal("0.00") or total_discount <= Decimal("0.00"):
        return [Decimal("0.00") for _ in net_amounts]

    effective_discount = min(total_discount, total_net)
    shares = [
        round_money(effective_discount * (net / total_net)) if net > Decimal("0.00") else Decimal("0.00")
        for net in net_amounts
    ]
    diff = effective_discount - sum(shares)
    if diff != Decimal("0.00") and net_amounts:
        max_idx = max(range(len(net_amounts)), key=lambda i: net_amounts[i])
        shares[max_idx] += diff

    return shares
