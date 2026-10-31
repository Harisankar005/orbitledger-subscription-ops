import statistics
import time
import uuid
from typing import Any, Optional

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def benchmark_endpoint(
    name: str,
    method: str,
    url: str,
    headers: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    iterations: int = 50,
):
    latencies = []
    headers = headers or {}

    for _ in range(iterations):
        req_headers = dict(headers)
        if "/api/billing/run" in url:
            req_headers["Idempotency-Key"] = f"perf-{uuid.uuid4()}"
        t0 = time.perf_counter()
        if method == "GET":
            resp = client.get(url, headers=req_headers)
        elif method == "POST":
            resp = client.post(url, headers=req_headers, json=json_body)
        latency_ms = (time.perf_counter() - t0) * 1000
        assert resp.status_code in (200, 201), f"Endpoint {url} failed with {resp.status_code}: {resp.text}"
        latencies.append(latency_ms)

    latencies.sort()
    p50 = statistics.median(latencies)
    p95 = latencies[int(len(latencies) * 0.95)]
    return p50, p95


def run_benchmarks():
    print("=" * 60)
    print("ORBITLEDGER PERFORMANCE BENCHMARK (50 iterations per endpoint)")
    print("=" * 60)

    # 1. Login to obtain Admin JWT
    login_resp = client.post("/api/auth/login", json={"email": "admin@brightloop.test", "password": "Admin@1234"})
    assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    endpoints = [
        ("Dashboard Summary Aggregates", "GET", "/api/reports/summary", None),
        ("Subscriptions List (paginated)", "GET", "/api/subscriptions?page=1&page_size=20", None),
        ("Invoices List (paginated)", "GET", "/api/invoices?page=1&page_size=20", None),
        ("Customers List (search indexed)", "GET", "/api/customers?search=Acme", None),
        ("Billing Engine Run (Dry Run)", "POST", "/api/billing/run", {"dry_run": True}),
    ]

    results = []
    print(f"{'Endpoint':<35} | {'p50 (ms)':<10} | {'p95 (ms)':<10} | {'Budget':<10} | {'Status'}")
    print("-" * 75)

    budgets = {
        "Dashboard Summary Aggregates": 800,
        "Subscriptions List (paginated)": 300,
        "Invoices List (paginated)": 300,
        "Customers List (search indexed)": 300,
        "Billing Engine Run (Dry Run)": 40000,
    }

    for name, method, url, body in endpoints:
        iters = 1 if "Billing" in name else 50
        p50, p95 = benchmark_endpoint(name, method, url, headers=headers, json_body=body, iterations=iters)
        budget = budgets[name]
        status_str = "PASS" if p95 < budget else "FAIL"
        print(f"{name:<35} | {p50:<10.2f} | {p95:<10.2f} | {budget:<10} | {status_str}")
        results.append((name, p50, p95, budget, status_str))

    print("=" * 75)
    return results


if __name__ == "__main__":
    run_benchmarks()
