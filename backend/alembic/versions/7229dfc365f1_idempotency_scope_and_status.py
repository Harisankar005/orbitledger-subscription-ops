"""idempotency_scope_and_status

Revision ID: 7229dfc365f1
Revises: a073f374f436
Create Date: 2026-10-31 12:04:01.949460

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7229dfc365f1'
down_revision: Union[str, None] = 'a073f374f436'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('idempotency_keys')
    op.create_table(
        'idempotency_keys',
        sa.Column('id', sa.BigInteger().with_variant(sa.Integer(), 'sqlite'), primary_key=True, autoincrement=True),
        sa.Column('scope', sa.String(length=100), nullable=False, server_default='default'),
        sa.Column('key', sa.String(length=128), nullable=False),
        sa.Column('endpoint', sa.String(length=255), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response_json', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='in_progress'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('scope', 'key', name='uq_idempotency_scope_key'),
    )
    op.create_index('ix_idempotency_keys_scope', 'idempotency_keys', ['scope'])
    op.create_index('ix_idempotency_keys_key', 'idempotency_keys', ['key'])
    op.create_index('ix_idempotency_keys_status', 'idempotency_keys', ['status'])


def downgrade() -> None:
    op.drop_table('idempotency_keys')
    op.create_table(
        'idempotency_keys',
        sa.Column('key', sa.String(length=128), primary_key=True, nullable=False),
        sa.Column('endpoint', sa.String(length=255), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('response_json', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
