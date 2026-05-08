"""add user server defaults

Revision ID: 0002_add_user_server_defaults
Revises: 0001_create_users
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_add_user_server_defaults"
down_revision: str | None = "0001_create_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_context().dialect.name != "postgresql":
        return

    op.alter_column("users", "status", server_default="offline")
    op.alter_column("users", "is_active", server_default=sa.true())


def downgrade() -> None:
    if op.get_context().dialect.name != "postgresql":
        return

    op.alter_column("users", "is_active", server_default=None)
    op.alter_column("users", "status", server_default=None)
