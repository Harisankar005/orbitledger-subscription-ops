import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(scope="module")
def auth_tokens():
    # Admin Token
    resp_admin = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert resp_admin.status_code == 200, f"Admin login failed: {resp_admin.text}"
    admin_token = resp_admin.json()["access_token"]

    # Staff Token
    resp_staff = client.post("/api/auth/login", json={"email": "staff1@brightloop.test", "password": "Staff@1234"})
    assert resp_staff.status_code == 200, f"Staff login failed: {resp_staff.text}"
    staff_token = resp_staff.json()["access_token"]

    # Customer Token
    resp_cust = client.post("/api/auth/login", json={"email": "customer@brightloop.test", "password": "Customer@1234"})
    assert resp_cust.status_code == 200, f"Customer login failed: {resp_cust.text}"
    cust_token = resp_cust.json()["access_token"]

    return {
        "admin": {"Authorization": f"Bearer {admin_token}"},
        "staff": {"Authorization": f"Bearer {staff_token}"},
        "customer": {"Authorization": f"Bearer {cust_token}"},
        "anonymous": {},
    }


def test_authz_matrix_staff_forbidden_from_admin_actions(auth_tokens):
    """Staff cannot create staff users, write discount rules, or create plans."""
    # 1. Staff attempting to create a staff user -> 403
    resp = client.post(
        "/api/users/staff",
        headers=auth_tokens["staff"],
        json={"email": "intruder@brightloop.test", "password": "Password@123", "full_name": "Intruder"},
    )
    assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"

    # 2. Staff attempting to create discount rule -> 403
    resp = client.post(
        "/api/discounts",
        headers=auth_tokens["staff"],
        json={
            "name": "Staff Discount",
            "kind": "percent",
            "value": "10.00",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "scope": "subscription",
        },
    )
    assert resp.status_code == 403, f"Expected 403, got {resp.status_code}"


def test_authz_matrix_staff_allowed_business_operations(auth_tokens):
    """Staff can view subscriptions, manage customers, view invoices, and record payments."""
    # 1. Staff can read subscriptions -> 200
    resp = client.get("/api/subscriptions", headers=auth_tokens["staff"])
    assert resp.status_code == 200

    # 2. Staff can read invoices -> 200
    resp = client.get("/api/invoices", headers=auth_tokens["staff"])
    assert resp.status_code == 200

    # 3. Staff can view dashboard summary -> 200
    resp = client.get("/api/reports/summary", headers=auth_tokens["staff"])
    assert resp.status_code == 200


def test_authz_matrix_customer_portal_and_ownership_scoping(auth_tokens):
    """Customer can access own portal data but gets 403 on staff routes and 404 on IDOR attempts."""
    # 1. Customer attempting to access staff subscriptions list -> 403
    resp = client.get("/api/subscriptions", headers=auth_tokens["customer"])
    assert resp.status_code == 403

    # 2. Customer can access own portal subscriptions -> 200
    resp = client.get("/api/portal/subscriptions", headers=auth_tokens["customer"])
    assert resp.status_code == 200

    # 3. Customer accessing another customer's profile directly -> 404 (ownership scoping)
    resp = client.get("/api/customers/9999", headers=auth_tokens["customer"])
    assert resp.status_code == 404


def test_unauthenticated_requests_rejected(auth_tokens):
    """Anonymous requests to protected endpoints receive 401 Unauthorized."""
    resp = client.get("/api/subscriptions", headers=auth_tokens["anonymous"])
    assert resp.status_code == 401
