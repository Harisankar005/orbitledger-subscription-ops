"""Pytest test isolation configuration.

Guarantees tests use an isolated database (temp SQLite file or test schema via env override)
and never touch or mutate brightloop.db.
"""
# ruff: noqa: E402

import atexit
import os
import tempfile

import pytest
from sqlalchemy import create_engine, event

# 1. Determine isolated database URL
original_db_url = os.environ.get("DATABASE_URL")

_temp_db_file = None
if not original_db_url or "brightloop.db" in original_db_url:
    _temp_db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    _temp_db_path = _temp_db_file.name
    _temp_db_file.close()
    test_db_url = f"sqlite:///{_temp_db_path}"
    os.environ["DATABASE_URL"] = test_db_url
else:
    test_db_url = original_db_url
    _temp_db_path = None

os.environ["ENVIRONMENT"] = "test"
os.environ["EMBEDDED_WORKER"] = "false"
if "SECRET_KEY" not in os.environ:
    os.environ["SECRET_KEY"] = "test-secret-key-at-least-32-chars-long-2026"

# 2. Re-bind app settings and SQLAlchemy engine to the isolated test database
from app.config import get_settings, settings

get_settings.cache_clear()
settings.DATABASE_URL = test_db_url
settings.ENVIRONMENT = "test"
settings.EMBEDDED_WORKER = False

import app.db

app.db.engine.dispose()

connect_args = {}
if test_db_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

test_engine = create_engine(
    test_db_url,
    connect_args=connect_args,
    pool_pre_ping=True,
)

if test_db_url.startswith("sqlite"):
    @event.listens_for(test_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

app.db.engine = test_engine
app.db.SessionLocal.configure(bind=test_engine)


def _cleanup():
    try:
        app.db.engine.dispose()
    except Exception:
        pass
    if _temp_db_path and os.path.exists(_temp_db_path):
        try:
            os.remove(_temp_db_path)
        except OSError:
            pass


atexit.register(_cleanup)


@pytest.fixture(scope="session", autouse=True)
def isolated_test_database():
    """Seed the isolated database once for the entire test session."""
    from app.seed import seed_database
    seed_database(small=True, reset=True)
    yield
    _cleanup()
