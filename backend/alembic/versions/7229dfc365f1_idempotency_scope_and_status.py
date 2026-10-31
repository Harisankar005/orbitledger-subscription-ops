"""idempotency_scope_and_status

Revision ID: 7229dfc365f1
Revises: a073f374f436
Create Date: 2026-10-31 12:04:01.949460

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7229dfc365f1'
down_revision: Union[str, None] = 'a073f374f436'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('idempotency_keys')]
    if 'scope' in cols and 'status' in cols:
        return

    # 1. Create temporary table with target schema
    op.create_table(
        'idempotency_keys_v2',
        sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), primary_key=True, autoincrement=True),
        sa.Column('scope', sa.String(length=100), nullable=False),
        sa.Column('key', sa.String(length=128), nullable=False),
        sa.Column('endpoint', sa.String(length=255), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response_json', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('scope', 'key', name='uq_idempotency_scope_key'),
    )

    # 2. Backfill existing records with deterministic scope, status, updated_at, and deduplication
    copy_sql = sa.text("""
        WITH ranked AS (
            SELECT 
                CASE 
                    WHEN endpoint LIKE '/api/billing%' THEN 'billing.run'
                    WHEN endpoint LIKE '/api/payments%' THEN 'payments.record'
                    ELSE 'default'
                END AS scope,
                key,
                endpoint,
                request_hash,
                response_json,
                CASE 
                    WHEN response_json = '__IN_PROGRESS__' THEN 'in_progress'
                    ELSE 'completed'
                END AS status,
                created_at,
                created_at AS updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY 
                        CASE 
                            WHEN endpoint LIKE '/api/billing%' THEN 'billing.run'
                            WHEN endpoint LIKE '/api/payments%' THEN 'payments.record'
                            ELSE 'default'
                        END, 
                        key 
                    ORDER BY 
                        CASE WHEN response_json != '__IN_PROGRESS__' THEN 0 ELSE 1 END ASC,
                        created_at DESC
                ) AS rn
            FROM idempotency_keys
        )
        INSERT INTO idempotency_keys_v2 (scope, key, endpoint, request_hash, response_json, status, created_at, updated_at)
        SELECT scope, key, endpoint, request_hash, response_json, status, created_at, updated_at
        FROM ranked
        WHERE rn = 1
    """)
    op.execute(copy_sql)

    # 3. Swap tables safely
    op.drop_table('idempotency_keys')
    op.rename_table('idempotency_keys_v2', 'idempotency_keys')

    # 4. Create indexes
    op.create_index('ix_idempotency_keys_scope', 'idempotency_keys', ['scope'])
    op.create_index('ix_idempotency_keys_key', 'idempotency_keys', ['key'])
    op.create_index('ix_idempotency_keys_status', 'idempotency_keys', ['status'])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    cols = [c['name'] for c in inspector.get_columns('idempotency_keys')]
    if 'scope' not in cols:
        return

    # 1. Create temporary table with old schema
    op.create_table(
        'idempotency_keys_v1',
        sa.Column('key', sa.String(length=128), primary_key=True, nullable=False),
        sa.Column('endpoint', sa.String(length=255), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )

    # 2. Backfill with deterministic deduplication on key
    copy_sql = sa.text("""
        WITH ranked AS (
            SELECT 
                key,
                endpoint,
                request_hash,
                response_json,
                created_at,
                ROW_NUMBER() OVER (
                    PARTITION BY key 
                    ORDER BY 
                        CASE WHEN status = 'completed' AND response_json != '__IN_PROGRESS__' THEN 0 ELSE 1 END ASC,
                        updated_at DESC,
                        created_at DESC
                ) AS rn
            FROM idempotency_keys
        )
        INSERT INTO idempotency_keys_v1 (key, endpoint, request_hash, response_json, created_at)
        SELECT key, endpoint, request_hash, response_json, created_at
        FROM ranked
        WHERE rn = 1
    """)
    op.execute(copy_sql)

    # 3. Swap tables
    op.drop_table('idempotency_keys')
    op.rename_table('idempotency_keys_v1', 'idempotency_keys')
