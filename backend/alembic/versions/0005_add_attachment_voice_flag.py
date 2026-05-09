"""add attachment voice flag

Revision ID: 0005_add_attachment_voice_flag
Revises: 0004_add_topic_metadata
Create Date: 2026-05-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_add_attachment_voice_flag"
down_revision: str | None = "0004_add_topic_metadata"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "message_attachments",
        sa.Column("is_voice_message", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    if op.get_context().dialect.name == "postgresql":
        op.alter_column("message_attachments", "is_voice_message", server_default=None)


def downgrade() -> None:
    op.drop_column("message_attachments", "is_voice_message")
