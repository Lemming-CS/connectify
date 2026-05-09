"""add topic metadata

Revision ID: 0004_add_topic_metadata
Revises: 0003_create_messaging_foundation
Create Date: 2026-05-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_add_topic_metadata"
down_revision: str | None = "0003_create_messaging_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversation_topics", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("conversation_topics", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("conversation_topics", "archived_at")
    op.drop_column("conversation_topics", "description")
