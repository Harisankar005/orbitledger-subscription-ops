import uuid
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.errors import (
    AppException,
    app_exception_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from app.logging import setup_logging
from app.routers.auth import router as auth_router
from app.routers.billing import router as billing_router
from app.routers.catalog import router as catalog_router
from app.routers.customers import router as customers_router
from app.routers.discounts import router as discounts_router
from app.routers.invoices import router as invoices_router
from app.routers.payments import router as payments_router
from app.routers.platform import router as platform_router
from app.routers.portal import router as portal_router
from app.routers.reports import router as reports_router
from app.routers.subscriptions import router as subscriptions_router
from app.routers.users import router as users_router
from app.worker import start_scheduler

setup_logging()
logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = None
    if settings.EMBEDDED_WORKER:
        logger.info("embedded_worker_enabled_starting_scheduler")
        scheduler = start_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="Brightloop Subscription Management Platform",
    description="Engineered by B. Harisankar and Rohan S for the Odoo Hackathon",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    contact={
        "name": "B. Harisankar and Rohan S",
        "url": "https://github.com/Harisankar005/demo",
    },
    lifespan=lifespan,
)

# CORS Middleware (strict same-origin by default, permissive in dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:80"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_and_security_headers_middleware(request: Request, call_next):
    """Inject X-Request-ID and enforce defensive HTTP security headers (PLAN.md 5.1)."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id

    response = await call_next(request)

    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


# Exception Handlers
app.add_exception_handler(AppException, app_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, generic_exception_handler)

# API Routers mounted under /api
app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(customers_router, prefix="/api")
app.include_router(catalog_router, prefix="/api")
app.include_router(catalog_router, prefix="/api/catalog")
app.include_router(subscriptions_router, prefix="/api")
app.include_router(discounts_router, prefix="/api")
app.include_router(billing_router, prefix="/api")
app.include_router(invoices_router, prefix="/api")
app.include_router(payments_router, prefix="/api")
app.include_router(reports_router, prefix="/api")
app.include_router(portal_router, prefix="/api")
app.include_router(platform_router, prefix="/api")
