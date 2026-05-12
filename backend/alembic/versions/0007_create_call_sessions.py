"""create call sessions

Revision ID: 0007_create_call_sessions
Revises: 0006_create_notifications
Create Date: 2026-05-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_create_call_sessions"
down_revision: str | None = "0006_create_notifications"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "call_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("caller_id", sa.Integer(), nullable=False),
        sa.Column("callee_id", sa.Integer(), nullable=False),
        sa.Column("ended_by_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('audio', 'video')", name="ck_call_sessions_kind"),
        sa.CheckConstraint(
            "status IN ('ringing', 'active', 'rejected', 'ended', 'canceled')",
            name="ck_call_sessions_status",
        ),
        sa.ForeignKeyConstraint(["callee_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["caller_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"]),
        sa.ForeignKeyConstraint(["ended_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_call_sessions_id"), "call_sessions", ["id"], unique=False)
    op.create_index(op.f("ix_call_sessions_conversation_id"), "call_sessions", ["conversation_id"], unique=False)
    op.create_index(op.f("ix_call_sessions_caller_id"), "call_sessions", ["caller_id"], unique=False)
    op.create_index(op.f("ix_call_sessions_callee_id"), "call_sessions", ["callee_id"], unique=False)
    op.create_index(op.f("ix_call_sessions_ended_by_id"), "call_sessions", ["ended_by_id"], unique=False)
    op.create_index(
        "ix_call_sessions_conversation_created_at",
        "call_sessions",
        ["conversation_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_call_sessions_conversation_status",
        "call_sessions",
        ["conversation_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_call_sessions_conversation_status", table_name="call_sessions")
    op.drop_index("ix_call_sessions_conversation_created_at", table_name="call_sessions")
    op.drop_index(op.f("ix_call_sessions_ended_by_id"), table_name="call_sessions")
    op.drop_index(op.f("ix_call_sessions_callee_id"), table_name="call_sessions")
    op.drop_index(op.f("ix_call_sessions_caller_id"), table_name="call_sessions")
    op.drop_index(op.f("ix_call_sessions_conversation_id"), table_name="call_sessions")
    op.drop_index(op.f("ix_call_sessions_id"), table_name="call_sessions")
    op.drop_table("call_sessions")
