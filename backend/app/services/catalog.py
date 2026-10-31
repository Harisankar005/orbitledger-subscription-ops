from typing import Optional

from sqlalchemy.orm import Session

from app.errors import ConflictError, NotFoundError, ValidationError
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
from app.schemas.catalog import (
    PaymentTermCreate,
    PlanCreate,
    PlanUpdate,
    ProductCreate,
    ProductUpdate,
    ProductVariantCreate,
    QuotationTemplateCreate,
    QuotationTemplateUpdate,
    TaxCreate,
    TaxRuleCreate,
    TaxRuleUpdate,
    TaxUpdate,
)
from app.services.audit import log_audit

# ---------------- Products & Variants ----------------

def create_product(db: Session, req: ProductCreate, actor_id: int, request_id: Optional[str] = None) -> Product:
    prod = Product(**req.model_dump())
    db.add(prod)
    db.flush()
    log_audit(db, actor_id, "product.created", "product", prod.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(prod)
    return prod


def update_product(db: Session, product_id: int, req: ProductUpdate, actor_id: int, request_id: Optional[str] = None) -> Product:
    prod = db.query(Product).filter(Product.id == product_id).first()
    if not prod:
        raise NotFoundError("Product not found")

    before = {"name": prod.name, "sales_price": str(prod.sales_price), "is_active": prod.is_active}
    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(prod, k, v)

    after = {"name": prod.name, "sales_price": str(prod.sales_price), "is_active": prod.is_active}
    log_audit(db, actor_id, "product.updated", "product", prod.id, before=before, after=after, request_id=request_id)
    db.commit()
    db.refresh(prod)
    return prod


def add_product_variant(db: Session, product_id: int, req: ProductVariantCreate, actor_id: int, request_id: Optional[str] = None) -> ProductVariant:
    prod = db.query(Product).filter(Product.id == product_id).first()
    if not prod:
        raise NotFoundError("Product not found")

    existing = db.query(ProductVariant).filter(
        ProductVariant.product_id == product_id,
        ProductVariant.attribute == req.attribute.strip(),
        ProductVariant.value == req.value.strip(),
    ).first()
    if existing:
        raise ConflictError(f"Variant '{req.attribute}={req.value}' already exists for this product")

    variant = ProductVariant(
        product_id=product_id,
        attribute=req.attribute.strip(),
        value=req.value.strip(),
        extra_price=req.extra_price,
    )
    db.add(variant)
    db.flush()
    log_audit(db, actor_id, "product_variant.created", "product_variant", variant.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(variant)
    return variant


# ---------------- Taxes & Tax Rules ----------------

def create_tax(db: Session, req: TaxCreate, actor_id: int, request_id: Optional[str] = None) -> Tax:
    if db.query(Tax).filter(Tax.name == req.name.strip()).first():
        raise ConflictError("Tax with this name already exists")
    tax = Tax(**req.model_dump())
    db.add(tax)
    db.flush()
    log_audit(db, actor_id, "tax.created", "tax", tax.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(tax)
    return tax


def update_tax(db: Session, tax_id: int, req: TaxUpdate, actor_id: int, request_id: Optional[str] = None) -> Tax:
    tax = db.query(Tax).filter(Tax.id == tax_id).first()
    if not tax:
        raise NotFoundError("Tax not found")
    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(tax, k, v)
    log_audit(db, actor_id, "tax.updated", "tax", tax.id, after=update_data, request_id=request_id)
    db.commit()
    db.refresh(tax)
    return tax


def create_tax_rule(db: Session, req: TaxRuleCreate, actor_id: int, request_id: Optional[str] = None) -> TaxRule:
    rule = TaxRule(**req.model_dump())
    db.add(rule)
    db.flush()
    log_audit(db, actor_id, "tax_rule.created", "tax_rule", rule.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(rule)
    return rule


def update_tax_rule(db: Session, rule_id: int, req: TaxRuleUpdate, actor_id: int, request_id: Optional[str] = None) -> TaxRule:
    rule = db.query(TaxRule).filter(TaxRule.id == rule_id).first()
    if not rule:
        raise NotFoundError("Tax rule not found")
    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(rule, k, v)
    log_audit(db, actor_id, "tax_rule.updated", "tax_rule", rule.id, after=update_data, request_id=request_id)
    db.commit()
    db.refresh(rule)
    return rule


# ---------------- Payment Terms ----------------

def create_payment_term(db: Session, req: PaymentTermCreate, actor_id: int, request_id: Optional[str] = None) -> PaymentTerm:
    if db.query(PaymentTerm).filter(PaymentTerm.name == req.name.strip()).first():
        raise ConflictError("Payment term with this name already exists")
    term = PaymentTerm(**req.model_dump())
    db.add(term)
    db.flush()
    log_audit(db, actor_id, "payment_term.created", "payment_term", term.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(term)
    return term


# ---------------- Plans ----------------

def create_plan(db: Session, req: PlanCreate, actor_id: int, request_id: Optional[str] = None) -> Plan:
    if db.query(Plan).filter(Plan.name == req.name.strip()).first():
        raise ConflictError("Plan with this name already exists")
    if req.available_from > req.available_to:
        raise ValidationError("available_from cannot be after available_to")
    plan = Plan(**req.model_dump())
    db.add(plan)
    db.flush()
    log_audit(db, actor_id, "plan.created", "plan", plan.id, after=req.model_dump(), request_id=request_id)
    db.commit()
    db.refresh(plan)
    return plan


def update_plan(db: Session, plan_id: int, req: PlanUpdate, actor_id: int, request_id: Optional[str] = None) -> Plan:
    plan = db.query(Plan).filter(Plan.id == plan_id).first()
    if not plan:
        raise NotFoundError("Plan not found")
    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(plan, k, v)
    if plan.available_from > plan.available_to:
        raise ValidationError("available_from cannot be after available_to")
    log_audit(db, actor_id, "plan.updated", "plan", plan.id, after=update_data, request_id=request_id)
    db.commit()
    db.refresh(plan)
    return plan


# ---------------- Quotation Templates ----------------

def create_quotation_template(db: Session, req: QuotationTemplateCreate, actor_id: int, request_id: Optional[str] = None) -> QuotationTemplate:
    if db.query(QuotationTemplate).filter(QuotationTemplate.name == req.name.strip()).first():
        raise ConflictError("Quotation template with this name already exists")
    template = QuotationTemplate(
        name=req.name.strip(),
        plan_id=req.plan_id,
        validity_days=req.validity_days,
        payment_term_id=req.payment_term_id,
        is_active=req.is_active,
    )
    db.add(template)
    db.flush()

    for line_req in req.lines:
        line = QuotationTemplateLine(
            template_id=template.id,
            product_id=line_req.product_id,
            variant_id=line_req.variant_id,
            quantity=line_req.quantity,
        )
        db.add(line)

    db.flush()
    log_audit(db, actor_id, "quotation_template.created", "quotation_template", template.id, after={"name": template.name}, request_id=request_id)
    db.commit()
    db.refresh(template)
    return template


def update_quotation_template(
    db: Session,
    template_id: int,
    req: QuotationTemplateUpdate,
    actor_id: int,
    request_id: Optional[str] = None,
) -> QuotationTemplate:
    template = db.query(QuotationTemplate).filter(QuotationTemplate.id == template_id).first()
    if not template:
        raise NotFoundError("Quotation template not found")

    before = {"name": template.name, "is_active": template.is_active}

    if req.name is not None:
        clean_name = req.name.strip()
        existing = (
            db.query(QuotationTemplate)
            .filter(QuotationTemplate.name == clean_name, QuotationTemplate.id != template_id)
            .first()
        )
        if existing:
            raise ConflictError("Quotation template with this name already exists")
        template.name = clean_name

    if req.plan_id is not None:
        plan = db.query(Plan).filter(Plan.id == req.plan_id).first()
        if not plan:
            raise NotFoundError("Plan not found")
        template.plan_id = req.plan_id

    if req.validity_days is not None:
        template.validity_days = req.validity_days

    if req.payment_term_id is not None:
        term = db.query(PaymentTerm).filter(PaymentTerm.id == req.payment_term_id).first()
        if not term:
            raise NotFoundError("Payment term not found")
        template.payment_term_id = req.payment_term_id

    if req.is_active is not None:
        template.is_active = req.is_active

    if req.lines is not None:
        for old_line in list(template.lines):
            db.delete(old_line)
        db.flush()
        template.lines = []
        for line_req in req.lines:
            line = QuotationTemplateLine(
                template_id=template.id,
                product_id=line_req.product_id,
                variant_id=line_req.variant_id,
                quantity=line_req.quantity,
            )
            db.add(line)

    db.flush()
    log_audit(
        db,
        actor_id,
        "quotation_template.updated",
        "quotation_template",
        template.id,
        before=before,
        after={"name": template.name, "is_active": template.is_active},
        request_id=request_id,
    )
    db.commit()
    db.refresh(template)
    return template
