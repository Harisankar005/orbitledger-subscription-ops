import uuid
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.main import app
from app.models.platform import OutboxMessage

client = TestClient(app)


@pytest.fixture(scope="module")
def auth_tokens():
    resp_admin = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert resp_admin.status_code == 200, f"Admin login failed: {resp_admin.text}"
    admin_token = resp_admin.json()["access_token"]

    resp_staff = client.post("/api/auth/login", json={"email": "staff1@brightloop.test", "password": "Staff@1234"})
    assert resp_staff.status_code == 200, f"Staff login failed: {resp_staff.text}"
    staff_token = resp_staff.json()["access_token"]

    return {
        "admin": {"Authorization": f"Bearer {admin_token}"},
        "staff": {"Authorization": f"Bearer {staff_token}"},
    }


def test_discount_toggle_admin_and_staff(auth_tokens):
    """Admin can toggle discount rule active state; staff is forbidden."""
    # Create a rule as admin
    rule_name = f"Toggle Test Rule {uuid.uuid4().hex[:6]}"
    create_resp = client.post(
        "/api/discounts",
        headers=auth_tokens["admin"],
        json={
            "name": rule_name,
            "kind": "percent",
            "value": "15.00",
            "start_date": "2026-01-01",
            "end_date": "2026-12-31",
            "scope": "subscription",
            "is_active": True,
        },
    )
    assert create_resp.status_code == 201
    rule_id = create_resp.json()["id"]
    assert create_resp.json()["is_active"] is True

    # Staff attempt to toggle -> 403
    staff_toggle = client.post(f"/api/discounts/{rule_id}/toggle", headers=auth_tokens["staff"])
    assert staff_toggle.status_code == 403

    # Admin toggle -> False
    admin_toggle = client.post(f"/api/discounts/{rule_id}/toggle", headers=auth_tokens["admin"])
    assert admin_toggle.status_code == 200
    assert admin_toggle.json()["is_active"] is False

    # Admin toggle again -> True
    admin_toggle2 = client.post(f"/api/discounts/{rule_id}/toggle", headers=auth_tokens["admin"])
    assert admin_toggle2.status_code == 200
    assert admin_toggle2.json()["is_active"] is True


def test_outbox_retry_admin_and_staff(auth_tokens):
    """Admin can retry an outbox message resetting status to pending; staff is forbidden."""
    # Create an outbox message directly via DB
    db = next(get_db())
    msg = OutboxMessage(
        to_email="test@example.com",
        subject="Test Invoice Notification",
        body_html="<p>Please find your invoice attached.</p>",
        kind="invoice_sent",
        status="failed",
        last_error="Network timeout",
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    msg_id = msg.id

    # Staff attempt to retry -> 403
    staff_resp = client.post(f"/api/outbox/{msg_id}/retry", headers=auth_tokens["staff"])
    assert staff_resp.status_code == 403

    # Admin retry -> 200 and status pending
    admin_resp = client.post(f"/api/outbox/{msg_id}/retry", headers=auth_tokens["admin"])
    assert admin_resp.status_code == 200

    db.refresh(msg)
    assert msg.status == "pending"
    assert msg.last_error is None


def test_patch_subscription_draft_only(auth_tokens):
    """PATCH /subscriptions/{id} works on draft subscriptions and rejects non-drafts."""
    # 1. Create a draft subscription
    today = date.today()
    create_resp = client.post(
        "/api/subscriptions",
        headers=auth_tokens["admin"],
        json={
            "customer_id": 1,
            "plan_id": 1,
            "start_date": today.isoformat(),
            "expiry_date": (today + timedelta(days=365)).isoformat(),
            "lines": [
                {"product_id": 1, "quantity": 1},
            ],
        },
    )
    assert create_resp.status_code == 201
    sub_data = create_resp.json()
    sub_id = sub_data["id"]
    initial_version = sub_data["version"]
    assert sub_data["status"] == "draft"

    # 2. Patch draft subscription lines, dates, and notes
    new_expiry = (today + timedelta(days=180)).isoformat()
    patch_resp = client.patch(
        f"/api/subscriptions/{sub_id}",
        headers=auth_tokens["admin"],
        json={
            "notes": "Updated draft notes",
            "expiry_date": new_expiry,
            "lines": [
                {"product_id": 1, "quantity": 3},
            ],
        },
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["notes"] == "Updated draft notes"
    assert updated["expiry_date"] == new_expiry
    assert updated["version"] == initial_version + 1
    assert len(updated["lines"]) == 1
    assert updated["lines"][0]["quantity"] == 3

    # 3. Transition subscription to quotation
    trans_resp = client.post(
        f"/api/subscriptions/{sub_id}/transition",
        headers=auth_tokens["admin"],
        json={"target_status": "quotation", "expected_version": updated["version"]},
    )
    assert trans_resp.status_code == 200
    assert trans_resp.json()["status"] == "quotation"

    # 4. Attempt to PATCH now that it is quotation -> 409 Conflict
    conflict_resp = client.patch(
        f"/api/subscriptions/{sub_id}",
        headers=auth_tokens["admin"],
        json={"notes": "Should fail"},
    )
    assert conflict_resp.status_code == 409
    assert conflict_resp.json()["code"] == "SUBSCRIPTION_NOT_DRAFT"


def test_patch_subscription_date_validation(auth_tokens):
    """PATCH /subscriptions/{id} rejects start_date after expiry_date."""
    today = date.today()
    create_resp = client.post(
        "/api/subscriptions",
        headers=auth_tokens["admin"],
        json={
            "customer_id": 1,
            "plan_id": 1,
            "start_date": today.isoformat(),
            "expiry_date": (today + timedelta(days=365)).isoformat(),
            "lines": [{"product_id": 1, "quantity": 1}],
        },
    )
    assert create_resp.status_code == 201
    sub_id = create_resp.json()["id"]

    # Inverted dates: start after expiry
    patch_resp = client.patch(
        f"/api/subscriptions/{sub_id}",
        headers=auth_tokens["admin"],
        json={
            "start_date": (today + timedelta(days=10)).isoformat(),
            "expiry_date": today.isoformat(),
        },
    )
    assert patch_resp.status_code == 422


def test_quotation_template_create_and_edit(auth_tokens):
    """Admin can create and patch quotation templates."""
    # Create template
    t_name = f"Enterprise Pilot Template {uuid.uuid4().hex[:6]}"
    create_resp = client.post(
        "/api/quotation-templates",
        headers=auth_tokens["admin"],
        json={
            "name": t_name,
            "plan_id": 1,
            "validity_days": 45,
            "payment_term_id": 1,
            "is_active": True,
            "lines": [
                {"product_id": 1, "quantity": 2},
            ],
        },
    )
    assert create_resp.status_code == 201
    template = create_resp.json()
    template_id = template["id"]
    assert template["name"] == t_name
    assert template["validity_days"] == 45

    # Staff attempt to edit -> 403
    staff_edit = client.patch(
        f"/api/quotation-templates/{template_id}",
        headers=auth_tokens["staff"],
        json={"name": "Hacked Name"},
    )
    assert staff_edit.status_code == 403

    # Admin edit -> 200
    updated_name = f"Updated Pilot Template {uuid.uuid4().hex[:6]}"
    admin_edit = client.patch(
        f"/api/quotation-templates/{template_id}",
        headers=auth_tokens["admin"],
        json={
            "name": updated_name,
            "validity_days": 60,
            "is_active": False,
        },
    )
    assert admin_edit.status_code == 200
    updated = admin_edit.json()
    assert updated["name"] == updated_name
    assert updated["validity_days"] == 60
    assert updated["is_active"] is False
