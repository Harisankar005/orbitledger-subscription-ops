"""End-to-end verification script for OrbitLedger.

Simulates clean-volume workflow:
1. Migrates and seeds fresh small dataset.
2. User signup & login.
3. Subscription creation, line configuration, and transitions.
4. Idempotent billing execution.
5. Invoice payment recording and balance settlement.
6. Dashboard finance summary and overdue aging inspection.
7. Clock advancement via time-travel demo mode.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from datetime import timedelta
from decimal import Decimal
from fastapi.testclient import TestClient

from app.clock import clock
from app.config import settings
from app.main import app
from app.seed import seed_database

client = TestClient(app)

def run_e2e_verification():
    print("=" * 60)
    print("ORBITLEDGER END-TO-END FLOW VERIFICATION")
    print("=" * 60)

    # Step 1: Clean seed
    print("[1/7] Seeding fresh database (small seed)...")
    seed_database(small=True)
    print("      Seeded successfully.")

    # Step 2: Signup and authentication
    print("[2/7] Testing customer signup and authentication...")
    signup_payload = {
        "full_name": "Acme Ventures",
        "email": "procurement@acme-ventures.test",
        "password": "Password@2026Secure",
    }
    resp = client.post("/api/auth/register", json=signup_payload)
    assert resp.status_code == 201, f"Signup failed: {resp.text}"
    reg_data = resp.json()
    customer_user = reg_data["user"]
    print(f"      Customer registered: {customer_user['email']} (ID {customer_user['id']})")

    # Login as admin to perform operational actions
    login_resp = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
    admin_token = login_resp.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    print("      Admin authenticated successfully.")

    # Step 3: Create customer profile and subscription
    print("[3/7] Creating customer and subscription...")
    cust_resp = client.post(
        "/api/customers",
        headers=admin_headers,
        json={
            "name": "Acme Global Industries",
            "email": "billing@acme-global.test",
            "company": "Acme Corp",
            "address": "456 Corporate Parkway, Bengaluru",
            "tax_id": "GSTIN29ABCDE1234F1Z5",
        },
    )
    assert cust_resp.status_code == 201, f"Customer creation failed: {cust_resp.text}"
    customer_id = cust_resp.json()["id"]

    # Get available plans and products
    plans_resp = client.get("/api/plans", headers=admin_headers)
    assert plans_resp.status_code == 200
    plan_id = plans_resp.json()["items"][0]["id"]

    prods_resp = client.get("/api/products", headers=admin_headers)
    assert prods_resp.status_code == 200
    prod_id = prods_resp.json()["items"][0]["id"]

    today = clock.today()
    sub_payload = {
        "customer_id": customer_id,
        "plan_id": plan_id,
        "start_date": today.isoformat(),
        "expiry_date": (today + timedelta(days=365)).isoformat(),
        "payment_term_id": 1,
        "lines": [{"product_id": prod_id, "quantity": 5}],
    }
    sub_resp = client.post("/api/subscriptions", headers=admin_headers, json=sub_payload)
    assert sub_resp.status_code == 201, f"Subscription creation failed: {sub_resp.text}"
    sub = sub_resp.json()
    sub_id = sub["id"]
    print(f"      Subscription created in draft: {sub['number']} (ID {sub_id})")

    # Transition subscription: draft -> quotation -> confirmed -> active
    t1 = client.post(f"/api/subscriptions/{sub_id}/transition", headers=admin_headers, json={"target_status": "quotation"})
    assert t1.status_code == 200, f"Transition to quotation failed: {t1.text}"

    t2 = client.post(f"/api/subscriptions/{sub_id}/transition", headers=admin_headers, json={"target_status": "confirmed"})
    assert t2.status_code == 200, f"Transition to confirmed failed: {t2.text}"

    t3 = client.post(f"/api/subscriptions/{sub_id}/transition", headers=admin_headers, json={"target_status": "active"})
    assert t3.status_code == 200, f"Transition to active failed: {t3.text}"
    print(f"      Subscription {sub['number']} successfully activated.")

    # Step 4: Run billing engine
    print("[4/7] Running billing engine...")
    billing_resp = client.post(
        "/api/billing/run",
        headers={**admin_headers, "Idempotency-Key": f"test-billing-{clock.today()}"},
        json={"as_of_date": today.isoformat(), "dry_run": False},
    )
    assert billing_resp.status_code == 200, f"Billing run failed: {billing_resp.text}"
    billing_data = billing_resp.json()
    print(f"      Billing completed: {billing_data['created']} invoices generated, {len(billing_data['failed'])} failed.")

    # Step 5: Find newly generated invoice and record payment
    print("[5/7] Inspecting receivables and recording payment...")
    inv_list_resp = client.get(f"/api/invoices?customer_id={customer_id}", headers=admin_headers)
    assert inv_list_resp.status_code == 200
    invoices = inv_list_resp.json()["items"]
    assert len(invoices) > 0, "Expected generated invoice for new customer"
    target_invoice = invoices[0]
    inv_id = target_invoice["id"]
    total_amount = float(target_invoice["total"])
    print(f"      Invoice {target_invoice['number']}: Total = Rs {total_amount:.2f}")

    # Confirm invoice if draft
    if target_invoice["status"] == "draft":
        client.post(f"/api/invoices/{inv_id}/confirm", headers=admin_headers)

    # Record full payment
    payment_payload = {
        "invoice_id": inv_id,
        "amount": str(total_amount),
        "paid_on": today.isoformat(),
        "method": "upi",
        "note": "UPI/REF/998877",
    }
    pay_resp = client.post(
        "/api/payments",
        headers={**admin_headers, "Idempotency-Key": f"pay-test-{inv_id}"},
        json=payment_payload,
    )
    assert pay_resp.status_code == 201, f"Payment failed: {pay_resp.text}"
    print(f"      Payment recorded: Rs {total_amount:.2f} via UPI (Reference: UPI/REF/998877)")

    # Verify invoice payment status updated to paid
    inv_detail = client.get(f"/api/invoices/{inv_id}", headers=admin_headers).json()
    assert inv_detail["payment_status"].lower() == "paid"
    print(f"      Invoice {target_invoice['number']} status updated: {inv_detail['payment_status']}.")

    # Step 6: Verify Dashboard and Overdue reporting metrics
    print("[6/7] Checking Dashboard financial metrics & overdue reports...")
    summary_resp = client.get("/api/reports/summary", headers=admin_headers)
    assert summary_resp.status_code == 200
    summary = summary_resp.json()
    print(f"      Active Subscriptions : {summary['active_subscriptions']}")
    print(f"      Total Invoiced       : Rs {summary['total_invoiced']:,.2f}")
    print(f"      Total Collected      : Rs {summary['total_collected']:,.2f}")
    print(f"      Aging 1-30 Days      : Rs {summary['aging_buckets']['1_30_days']:,.2f}")
    print(f"      Aging 31-60 Days     : Rs {summary['aging_buckets']['31_60_days']:,.2f}")
    print(f"      Aging 61+ Days       : Rs {summary['aging_buckets']['61_plus_days']:,.2f}")

    overdue_resp = client.get("/api/reports/overdue", headers=admin_headers)
    assert overdue_resp.status_code == 200
    overdue_items = overdue_resp.json()["items"]
    print(f"      Overdue Invoices Listed: {len(overdue_items)} items")

    # Step 7: Time-travel clock advancement
    print("[7/7] Testing time-travel clock advancement (+1 month)...")
    advance_resp = client.post(
        "/api/demo/advance-clock",
        headers=admin_headers,
        json={"months": 1},
    )
    assert advance_resp.status_code == 200, f"Advance clock failed: {advance_resp.text}"
    adv_data = advance_resp.json()
    print(f"      Simulated clock advanced from {adv_data['old_date']} to {adv_data['new_date']}")
    print(f"      Auto-generated new cycle invoices: {adv_data['billing_result']['created']}")

    print("\n" + "=" * 60)
    print("SUCCESS: ALL END-TO-END WORKFLOWS COMPLETED CLEANLY!")
    print("=" * 60)

if __name__ == "__main__":
    run_e2e_verification()
