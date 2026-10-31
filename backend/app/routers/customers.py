from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_roles
from app.errors import ConflictError, NotFoundError
from app.models.identity import Customer, User
from app.schemas.auth import EMAIL_PATTERN, CustomerResponse
from app.services.audit import log_audit

router = APIRouter(prefix="/customers", tags=["customers"])


class CustomerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., pattern=EMAIL_PATTERN, max_length=255)
    phone: Optional[str] = Field(None, max_length=50)
    company: Optional[str] = Field(None, max_length=255)
    billing_address: Optional[str] = None
    tax_id: Optional[str] = Field(None, max_length=50)


class CustomerUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    email: Optional[str] = Field(None, pattern=EMAIL_PATTERN, max_length=255)
    phone: Optional[str] = None
    company: Optional[str] = None
    billing_address: Optional[str] = None
    tax_id: Optional[str] = None


@router.get("", response_model=Dict[str, Any])
def list_customers(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    query = db.query(Customer)
    if search:
        search_filter = f"%{search.strip().lower()}%"
        query = query.filter(
            Customer.name.ilike(search_filter)
            | Customer.email.ilike(search_filter)
            | Customer.company.ilike(search_filter)
        )

    total = query.count()
    items = query.order_by(Customer.name.asc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [CustomerResponse.model_validate(c) for c in items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{customer_id}", response_model=CustomerResponse)
def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise NotFoundError("Customer not found")

    # Scoping: If customer role, only allow access to own profile
    if current_user.role == "customer" and customer.user_id != current_user.id:
        raise NotFoundError("Customer not found")

    return CustomerResponse.model_validate(customer)


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(
    req: CustomerCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("admin", "staff")),
):
    clean_email = req.email.strip().lower()
    existing = db.query(Customer).filter(Customer.email == clean_email).first()
    if existing:
        raise ConflictError("A customer with this email already exists")

    cust = Customer(
        name=req.name.strip(),
        email=clean_email,
        phone=req.phone,
        company=req.company,
        billing_address=req.billing_address,
        tax_id=req.tax_id,
    )
    db.add(cust)
    db.flush()

    req_id = getattr(request.state, "request_id", None)
    log_audit(
        db=db,
        actor_id=current_user.id,
        action="customer.created",
        entity_type="customer",
        entity_id=cust.id,
        after=req.model_dump(),
        request_id=req_id,
    )
    db.commit()
    db.refresh(cust)
    return CustomerResponse.model_validate(cust)


@router.patch("/{customer_id}", response_model=CustomerResponse)
def update_customer(
    customer_id: int,
    req: CustomerUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise NotFoundError("Customer not found")

    if current_user.role == "customer" and customer.user_id != current_user.id:
        raise NotFoundError("Customer not found")

    before = {"name": customer.name, "email": customer.email, "company": customer.company}
    update_data = req.model_dump(exclude_unset=True)
    if "email" in update_data and update_data["email"]:
        update_data["email"] = update_data["email"].strip().lower()

    for k, v in update_data.items():
        setattr(customer, k, v)

    after = {"name": customer.name, "email": customer.email, "company": customer.company}

    req_id = getattr(request.state, "request_id", None)
    log_audit(
        db=db,
        actor_id=current_user.id,
        action="customer.updated",
        entity_type="customer",
        entity_id=customer.id,
        before=before,
        after=after,
        request_id=req_id,
    )
    db.commit()
    db.refresh(customer)
    return CustomerResponse.model_validate(customer)
