"""Test data preservation during Alembic migrations.

Ensures that migrating from the initial schema (a073f374f436) to the scoped
idempotency schema (7229dfc365f1) and back preserves all existing records,
correctly infers scopes and statuses, and enforces constraints.
"""

import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path


def test_alembic_migration_preserves_populated_data_on_upgrade_and_downgrade():
    """Verify that upgrading and downgrading between a073f374f436 and head never destroys data."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tmp:
        test_db_path = tmp.name

    try:
        env = os.environ.copy()
        env["DATABASE_URL"] = f"sqlite:///{test_db_path}"

        backend_dir = Path(__file__).resolve().parent.parent.parent

        def run_alembic(args_str: str) -> str:
            proc = subprocess.run(
                [sys.executable, "-m", "alembic"] + args_str.split(),
                cwd=str(backend_dir),
                env=env,
                capture_output=True,
                text=True,
            )
            assert proc.returncode == 0, f"Alembic command '{args_str}' failed:\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
            return proc.stdout

        # 1. Upgrade to a073f374f436 (initial legacy schema)
        run_alembic("upgrade a073f374f436")

        # 2. Populate legacy schema with diverse idempotency records
        conn = sqlite3.connect(test_db_path)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO idempotency_keys (key, endpoint, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
            ("bill-leg-1", "/api/billing/run", "hash_bill_legacy", '{"invoices_created": 5}', "2026-04-01 10:00:00"),
        )
        cur.execute(
            "INSERT INTO idempotency_keys (key, endpoint, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
            ("pay-leg-1", "/api/payments", "hash_pay_legacy", '{"payment_id": 42}', "2026-04-01 10:30:00"),
        )
        cur.execute(
            "INSERT INTO idempotency_keys (key, endpoint, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
            ("prog-leg-1", "/api/billing/run", "hash_prog_legacy", "__IN_PROGRESS__", "2026-04-01 11:00:00"),
        )
        cur.execute(
            "INSERT INTO idempotency_keys (key, endpoint, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)",
            ("custom-leg-1", "/api/custom/action", "hash_custom_legacy", '{"status": "ok"}', "2026-04-01 11:15:00"),
        )
        conn.commit()
        conn.close()

        # 3. Upgrade to head (7229dfc365f1)
        run_alembic("upgrade head")

        # 4. Verify all records survived with backfilled fields
        conn = sqlite3.connect(test_db_path)
        cur = conn.cursor()
        cur.execute("SELECT id, scope, key, endpoint, status, response_json, created_at, updated_at FROM idempotency_keys ORDER BY id")
        rows = cur.fetchall()
        assert len(rows) == 4, f"Data loss detected! Expected 4 records, found {len(rows)}"

        # Assert scope mapping
        bill_row = next(r for r in rows if r[2] == "bill-leg-1")
        assert bill_row[1] == "billing.run"
        assert bill_row[4] == "completed"
        assert bill_row[5] == '{"invoices_created": 5}'

        pay_row = next(r for r in rows if r[2] == "pay-leg-1")
        assert pay_row[1] == "payments.record"
        assert pay_row[4] == "completed"
        assert pay_row[5] == '{"payment_id": 42}'

        prog_row = next(r for r in rows if r[2] == "prog-leg-1")
        assert prog_row[1] == "billing.run"
        assert prog_row[4] == "in_progress"
        assert prog_row[5] == "__IN_PROGRESS__"

        custom_row = next(r for r in rows if r[2] == "custom-leg-1")
        assert custom_row[1] == "default"
        assert custom_row[4] == "completed"

        # Assert (scope, key) unique constraint is active: inserting duplicate fails with IntegrityError
        import pytest
        with pytest.raises(sqlite3.IntegrityError):
            cur.execute(
                "INSERT INTO idempotency_keys (scope, key, endpoint, request_hash, response_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ("billing.run", "bill-leg-1", "/api/billing/run", "hash_dup", "{}", "completed", "2026-04-01 12:00:00", "2026-04-01 12:00:00"),
            )
            conn.commit()

        # But same key in DIFFERENT scope succeeds!
        cur.execute(
            "INSERT INTO idempotency_keys (scope, key, endpoint, request_hash, response_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("different.scope", "bill-leg-1", "/api/billing/run", "hash_diff", "{}", "completed", "2026-04-01 12:00:00", "2026-04-01 12:00:00"),
        )
        conn.commit()
        conn.close()

        # 5. Downgrade to -1 (back to a073f374f436)
        run_alembic("downgrade -1")

        # 6. Verify records survived downgrade
        conn = sqlite3.connect(test_db_path)
        cur = conn.cursor()
        cur.execute("SELECT key, endpoint, request_hash, response_json, created_at FROM idempotency_keys ORDER BY key")
        downgraded_rows = cur.fetchall()
        # 4 original keys (bill-leg-1, custom-leg-1, pay-leg-1, prog-leg-1) preserved
        assert len(downgraded_rows) == 4, f"Data loss on downgrade! Found {len(downgraded_rows)}"
        conn.close()

        # 7. Re-upgrade to head succeeds
        run_alembic("upgrade head")

    finally:
        if os.path.exists(test_db_path):
            try:
                os.remove(test_db_path)
            except OSError:
                pass
