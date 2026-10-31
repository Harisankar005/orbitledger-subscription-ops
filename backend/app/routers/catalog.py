from typing import Any, Dict

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_roles
from app.errors import NotFoundError
from app.models.catalog import (
    PaymentTerm,
    Plan,
    Product,
    QuotationTemplate,
    Tax,
    TaxRule,
)
from app.models.identity import User
from app.schemas.catalog import (
    PaymentTermCreate,
    PaymentTermResponse,
    PlanCreate,
    PlanResponse,
    PlanUpdate,
    ProductCreate,
    ProductResponse,
    ProductUpdate,
    ProductVariantCreate,
    ProductVariantResponse,
    QuotationTemplateCreate,
    QuotationTemplateResponse,
    QuotationTemplateUpdate,
    TaxCreate,
    TaxResponse,
    TaxRuleCreate,
    TaxRuleResponse,
    TaxRuleUpdate,
    TaxUpdate,
)
from app.services import catalog as catalog_service

router = APIRouter(tags=["catalog"])


# ---------------- Products ----------------

@router.get("/products", response_model=Dict[str, Any])
def list_products(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    type: str = Query(None),
    is_active: bool = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    query = db.query(Product)
    if type:
        query = query.filter(Product.type == type)
    if is_active is not None:
        query = query.filter(Product.is_active == is_active)

    total = query.count()
    items = query.order_by(Product.name.asc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [ProductResponse.model_validate(p) for p in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/products/{product_id}", response_model=ProductResponse)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    prod = db.query(Product).filter(Product.id == product_id).first()
    if not prod:
        raise NotFoundError("Product not found")
    return ProductResponse.model_validate(prod)


@router.post("/products", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    req: ProductCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    prod = catalog_service.create_product(db, req, current_user.id, req_id)
    return ProductResponse.model_validate(prod)


@router.patch("/products/{product_id}", response_model=ProductResponse)
def update_product(
    product_id: int,
    req: ProductUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    prod = catalog_service.update_product(db, product_id, req, current_user.id, req_id)
    return ProductResponse.model_validate(prod)


@router.post("/products/{product_id}/variants", response_model=ProductVariantResponse, status_code=status.HTTP_201_CREATED)
def add_variant(
    product_id: int,
    req: ProductVariantCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    variant = catalog_service.add_product_variant(db, product_id, req, current_user.id, req_id)
    return ProductVariantResponse.model_validate(variant)


# ---------------- Taxes & Rules ----------------

@router.get("/taxes", response_model=Dict[str, Any])
def list_taxes(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    taxes = db.query(Tax).order_by(Tax.id.asc()).all()
    return {
        "items": [TaxResponse.model_validate(t) for t in taxes],
        "total": len(taxes),
        "page": 1,
        "page_size": 100,
    }


@router.post("/taxes", response_model=TaxResponse, status_code=status.HTTP_201_CREATED)
def create_tax(
    req: TaxCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    tax = catalog_service.create_tax(db, req, current_user.id, req_id)
    return TaxResponse.model_validate(tax)


@router.patch("/taxes/{tax_id}", response_model=TaxResponse)
def update_tax(
    tax_id: int,
    req: TaxUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    tax = catalog_service.update_tax(db, tax_id, req, current_user.id, req_id)
    return TaxResponse.model_validate(tax)


@router.get("/tax-rules", response_model=Dict[str, Any])
def list_tax_rules(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    rules = db.query(TaxRule).order_by(TaxRule.priority.desc()).all()
    return {
        "items": [TaxRuleResponse.model_validate(r) for r in rules],
        "total": len(rules),
        "page": 1,
        "page_size": 100,
    }


@router.post("/tax-rules", response_model=TaxRuleResponse, status_code=status.HTTP_201_CREATED)
def create_tax_rule(
    req: TaxRuleCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    rule = catalog_service.create_tax_rule(db, req, current_user.id, req_id)
    return TaxRuleResponse.model_validate(rule)


@router.patch("/tax-rules/{rule_id}", response_model=TaxRuleResponse)
def update_tax_rule(
    rule_id: int,
    req: TaxRuleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    rule = catalog_service.update_tax_rule(db, rule_id, req, current_user.id, req_id)
    return TaxRuleResponse.model_validate(rule)


# ---------------- Payment Terms ----------------

@router.get("/payment-terms", response_model=Dict[str, Any])
def list_payment_terms(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    terms = db.query(PaymentTerm).order_by(PaymentTerm.days.asc()).all()
    return {
        "items": [PaymentTermResponse.model_validate(t) for t in terms],
        "total": len(terms),
        "page": 1,
        "page_size": 100,
    }


@router.post("/payment-terms", response_model=PaymentTermResponse, status_code=status.HTTP_201_CREATED)
def create_payment_term(
    req: PaymentTermCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    term = catalog_service.create_payment_term(db, req, current_user.id, req_id)
    return PaymentTermResponse.model_validate(term)


# ---------------- Plans ----------------

@router.get("/plans", response_model=Dict[str, Any])
def list_plans(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    plans = db.query(Plan).order_by(Plan.name.asc()).all()
    return {
        "items": [PlanResponse.model_validate(p) for p in plans],
        "total": len(plans),
        "page": 1,
        "page_size": 100,
    }


@router.post("/plans", response_model=PlanResponse, status_code=status.HTTP_201_CREATED)
def create_plan(
    req: PlanCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    plan = catalog_service.create_plan(db, req, current_user.id, req_id)
    return PlanResponse.model_validate(plan)


@router.patch("/plans/{plan_id}", response_model=PlanResponse)
def update_plan(
    plan_id: int,
    req: PlanUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    plan = catalog_service.update_plan(db, plan_id, req, current_user.id, req_id)
    return PlanResponse.model_validate(plan)


# ---------------- Quotation Templates ----------------

@router.get("/quotation-templates", response_model=Dict[str, Any])
def list_quotation_templates(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    templates = db.query(QuotationTemplate).order_by(QuotationTemplate.name.asc()).all()
    return {
        "items": [QuotationTemplateResponse.model_validate(t) for t in templates],
        "total": len(templates),
        "page": 1,
        "page_size": 100,
    }


@router.get("/quotation-templates/{template_id}", response_model=QuotationTemplateResponse)
def get_quotation_template(
    template_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "staff")),
):
    tpl = db.query(QuotationTemplate).filter(QuotationTemplate.id == template_id).first()
    if not tpl:
        raise NotFoundError("Quotation template not found")
    return QuotationTemplateResponse.model_validate(tpl)


@router.post("/quotation-templates", response_model=QuotationTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_quotation_template(
    req: QuotationTemplateCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    tpl = catalog_service.create_quotation_template(db, req, current_user.id, req_id)
    return QuotationTemplateResponse.model_validate(tpl)


@router.patch("/quotation-templates/{template_id}", response_model=QuotationTemplateResponse)
def update_quotation_template(
    template_id: int,
    req: QuotationTemplateUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin")),
):
    req_id = getattr(request.state, "request_id", None)
    tpl = catalog_service.update_quotation_template(db, template_id, req, current_user.id, req_id)
    return QuotationTemplateResponse.model_validate(tpl)
