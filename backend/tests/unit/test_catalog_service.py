"""Comprehensive tests for services/catalog.py."""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.db import SessionLocal
from app.errors import ConflictError, NotFoundError, ValidationError
from app.models.catalog import PaymentTerm, Plan, Product
from app.schemas.catalog import (
    PaymentTermCreate,
    PlanCreate,
    PlanUpdate,
    ProductCreate,
    ProductUpdate,
    ProductVariantCreate,
    QuotationTemplateCreate,
    QuotationTemplateLineCreate,
    QuotationTemplateUpdate,
    TaxCreate,
    TaxRuleCreate,
    TaxRuleUpdate,
    TaxUpdate,
)
from app.services.catalog import (
    add_product_variant,
    create_payment_term,
    create_plan,
    create_product,
    create_quotation_template,
    create_tax,
    create_tax_rule,
    update_plan,
    update_product,
    update_quotation_template,
    update_tax,
    update_tax_rule,
)


def test_product_crud_and_variants():
    with SessionLocal() as db:
        unique_suffix = uuid.uuid4().hex[:6]
        req = ProductCreate(
            name=f"Enterprise Widget {unique_suffix}",
            type="software",
            sales_price=Decimal("1500.00"),
            cost_price=Decimal("400.00"),
            notes="Initial product note",
        )
        prod = create_product(db, req, actor_id=1)
        assert prod.id is not None
        assert prod.sales_price == Decimal("1500.00")

        # Update product
        up_req = ProductUpdate(
            sales_price=Decimal("1800.00"),
            notes="Updated note",
        )
        updated = update_product(db, prod.id, up_req, actor_id=1)
        assert updated.sales_price == Decimal("1800.00")
        assert updated.notes == "Updated note"

        # Not found update
        with pytest.raises(NotFoundError, match="Product not found"):
            update_product(db, 999999, up_req, actor_id=1)

        # Add variant
        var_req = ProductVariantCreate(
            attribute="Seats",
            value="100-pack",
            extra_price=Decimal("500.00"),
        )
        variant = add_product_variant(db, prod.id, var_req, actor_id=1)
        assert variant.id is not None
        assert variant.extra_price == Decimal("500.00")

        # Duplicate variant conflict
        with pytest.raises(ConflictError, match="already exists"):
            add_product_variant(db, prod.id, var_req, actor_id=1)

        # Add variant for nonexistent product
        with pytest.raises(NotFoundError, match="Product not found"):
            add_product_variant(db, 999999, var_req, actor_id=1)


def test_tax_and_tax_rules_crud():
    with SessionLocal() as db:
        tax_name = f"VAT-{uuid.uuid4().hex[:6]}"
        tax_req = TaxCreate(
            name=tax_name,
            kind="percent",
            rate=Decimal("18.00"),
            is_active=True,
        )
        tax = create_tax(db, tax_req, actor_id=1)
        assert tax.id is not None
        assert tax.rate == Decimal("18.00")

        # Duplicate tax conflict
        with pytest.raises(ConflictError, match="already exists"):
            create_tax(db, tax_req, actor_id=1)

        # Update tax
        up_tax = TaxUpdate(rate=Decimal("20.00"))
        updated_tax = update_tax(db, tax.id, up_tax, actor_id=1)
        assert updated_tax.rate == Decimal("20.00")

        # Nonexistent tax update
        with pytest.raises(NotFoundError, match="Tax not found"):
            update_tax(db, 999999, up_tax, actor_id=1)

        # Tax rules
        rule_req = TaxRuleCreate(
            tax_id=tax.id,
            product_type="software",
            priority=5,
            is_active=True,
        )
        rule = create_tax_rule(db, rule_req, actor_id=1)
        assert rule.id is not None
        assert rule.priority == 5

        # Update rule
        up_rule = TaxRuleUpdate(priority=15)
        updated_rule = update_tax_rule(db, rule.id, up_rule, actor_id=1)
        assert updated_rule.priority == 15

        # Nonexistent rule update
        with pytest.raises(NotFoundError, match="Tax rule not found"):
            update_tax_rule(db, 999999, up_rule, actor_id=1)


def test_payment_terms_crud():
    with SessionLocal() as db:
        term_name = f"Net 45 {uuid.uuid4().hex[:6]}"
        term_req = PaymentTermCreate(name=term_name, days=45)
        term = create_payment_term(db, term_req, actor_id=1)
        assert term.id is not None
        assert term.days == 45

        # Duplicate payment term conflict
        with pytest.raises(ConflictError, match="already exists"):
            create_payment_term(db, term_req, actor_id=1)


def test_plan_crud_and_validation():
    with SessionLocal() as db:
        plan_name = f"Custom Growth Plan {uuid.uuid4().hex[:6]}"
        today = date.today()

        # Date validation error: available_from > available_to
        invalid_req = PlanCreate(
            name=plan_name,
            price=Decimal("499.00"),
            billing_period="monthly",
            min_quantity=5,
            available_from=today + timedelta(days=30),
            available_to=today,
            allow_pause=True,
            allow_early_close=True,
            allow_renew=True,
            auto_close_on_end=True,
        )
        with pytest.raises(ValidationError, match="available_from cannot be after available_to"):
            create_plan(db, invalid_req, actor_id=1)

        # Valid plan creation
        valid_req = PlanCreate(
            name=plan_name,
            price=Decimal("499.00"),
            billing_period="monthly",
            min_quantity=5,
            available_from=today - timedelta(days=10),
            available_to=today + timedelta(days=365),
            allow_pause=True,
            allow_early_close=True,
            allow_renew=True,
            auto_close_on_end=True,
        )
        plan = create_plan(db, valid_req, actor_id=1)
        assert plan.id is not None
        assert plan.min_quantity == 5

        # Duplicate name conflict
        with pytest.raises(ConflictError, match="already exists"):
            create_plan(db, valid_req, actor_id=1)

        # Update plan
        up_plan_req = PlanUpdate(price=Decimal("599.00"), min_quantity=10)
        updated_plan = update_plan(db, plan.id, up_plan_req, actor_id=1)
        assert updated_plan.price == Decimal("599.00")
        assert updated_plan.min_quantity == 10

        # Update with invalid date range
        invalid_dates_req = PlanUpdate(
            available_from=today + timedelta(days=400),
            available_to=today + timedelta(days=100),
        )
        with pytest.raises(ValidationError, match="available_from cannot be after available_to"):
            update_plan(db, plan.id, invalid_dates_req, actor_id=1)

        # Nonexistent plan update
        with pytest.raises(NotFoundError, match="Plan not found"):
            update_plan(db, 999999, up_plan_req, actor_id=1)


def test_quotation_template_crud():
    with SessionLocal() as db:
        prod = db.query(Product).first()
        plan = db.query(Plan).first()
        term = db.query(PaymentTerm).first()

        tpl_name = f"Enterprise Bundle {uuid.uuid4().hex[:6]}"
        req = QuotationTemplateCreate(
            name=tpl_name,
            plan_id=plan.id,
            validity_days=45,
            payment_term_id=term.id,
            is_active=True,
            lines=[
                QuotationTemplateLineCreate(product_id=prod.id, quantity=3),
            ],
        )
        tpl = create_quotation_template(db, req, actor_id=1)
        assert tpl.id is not None
        assert len(tpl.lines) == 1
        assert tpl.lines[0].quantity == 3

        # Duplicate template name conflict
        with pytest.raises(ConflictError, match="already exists"):
            create_quotation_template(db, req, actor_id=1)

        # Update template with new line items
        up_req = QuotationTemplateUpdate(
            validity_days=60,
            lines=[
                QuotationTemplateLineCreate(product_id=prod.id, quantity=10),
            ],
        )
        updated_tpl = update_quotation_template(db, tpl.id, up_req, actor_id=1)
        assert updated_tpl.validity_days == 60
        assert len(updated_tpl.lines) == 1
        assert updated_tpl.lines[0].quantity == 10

        # Update with invalid plan
        with pytest.raises(NotFoundError, match="Plan not found"):
            update_quotation_template(db, tpl.id, QuotationTemplateUpdate(plan_id=999999), actor_id=1)

        # Update with invalid payment term
        with pytest.raises(NotFoundError, match="Payment term not found"):
            update_quotation_template(db, tpl.id, QuotationTemplateUpdate(payment_term_id=999999), actor_id=1)

        # Nonexistent template update
        with pytest.raises(NotFoundError, match="Quotation template not found"):
            update_quotation_template(db, 999999, up_req, actor_id=1)
