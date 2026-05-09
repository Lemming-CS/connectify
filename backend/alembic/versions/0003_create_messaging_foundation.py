"""create messaging foundation tables

Revision ID: 0003_create_messaging_foundation
Revises: 0002_add_user_server_defaults
Create Date: 2026-05-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_create_messaging_foundation"
down_revision: str | None = "0002_add_user_server_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('direct', 'group', 'supergroup')",
            name="ck_conversations_kind",
        ),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_conversations_id"), "conversations", ["id"], unique=False)
    op.create_index(op.f("ix_conversations_kind"), "conversations", ["kind"], unique=False)
    op.create_index("ix_conversations_kind_last_message_at", "conversations", ["kind", "last_message_at"], unique=False)
    op.create_index(op.f("ix_conversations_created_by_id"), "conversations", ["created_by_id"], unique=False)

    op.create_table(
        "conversation_topics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("is_general", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_closed", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_conversation_topics_id"), "conversation_topics", ["id"], unique=False)
    op.create_index(op.f("ix_conversation_topics_conversation_id"), "conversation_topics", ["conversation_id"], unique=False)
    op.create_index(op.f("ix_conversation_topics_created_by_id"), "conversation_topics", ["created_by_id"], unique=False)
    op.create_index(
        "ix_conversation_topics_conversation_created_at",
        "conversation_topics",
        ["conversation_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("topic_id", sa.Integer(), nullable=True),
        sa.Column("sender_id", sa.Integer(), nullable=False),
        sa.Column("reply_to_message_id", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('text', 'system', 'call')",
            name="ck_messages_kind",
        ),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"]),
        sa.ForeignKeyConstraint(["reply_to_message_id"], ["messages.id"]),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["topic_id"], ["conversation_topics.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_id"), "messages", ["id"], unique=False)
    op.create_index(op.f("ix_messages_conversation_id"), "messages", ["conversation_id"], unique=False)
    op.create_index(op.f("ix_messages_sender_id"), "messages", ["sender_id"], unique=False)
    op.create_index(op.f("ix_messages_topic_id"), "messages", ["topic_id"], unique=False)
    op.create_index("ix_messages_conversation_created_at", "messages", ["conversation_id", "created_at"], unique=False)
    op.create_index("ix_messages_topic_created_at", "messages", ["topic_id", "created_at"], unique=False)

    op.create_table(
        "conversation_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("left_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_read_message_id", sa.Integer(), nullable=True),
        sa.Column("last_read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notifications_muted_until", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('member', 'admin', 'owner')",
            name="ck_conversation_members_role",
        ),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"]),
        sa.ForeignKeyConstraint(["last_read_message_id"], ["messages.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_conversation_members_conversation_user"),
    )
    op.create_index(op.f("ix_conversation_members_id"), "conversation_members", ["id"], unique=False)
    op.create_index(op.f("ix_conversation_members_conversation_id"), "conversation_members", ["conversation_id"], unique=False)
    op.create_index(op.f("ix_conversation_members_user_id"), "conversation_members", ["user_id"], unique=False)
    op.create_index(
        "ix_conversation_members_conversation_left_at",
        "conversation_members",
        ["conversation_id", "left_at"],
        unique=False,
    )
    op.create_index(
        "ix_conversation_members_user_left_at",
        "conversation_members",
        ["user_id", "left_at"],
        unique=False,
    )

    op.create_table(
        "message_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("uploader_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("storage_key", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("content_type", sa.String(length=255), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("checksum_sha256", sa.String(length=64), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('file', 'image', 'video', 'audio')",
            name="ck_message_attachments_kind",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'ready', 'failed')",
            name="ck_message_attachments_status",
        ),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"]),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_message_attachments_id"), "message_attachments", ["id"], unique=False)
    op.create_index(op.f("ix_message_attachments_message_id"), "message_attachments", ["message_id"], unique=False)
    op.create_index(op.f("ix_message_attachments_uploader_id"), "message_attachments", ["uploader_id"], unique=False)
    op.create_index(
        "ix_message_attachments_message_created_at",
        "message_attachments",
        ["message_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_message_attachments_message_created_at", table_name="message_attachments")
    op.drop_index(op.f("ix_message_attachments_uploader_id"), table_name="message_attachments")
    op.drop_index(op.f("ix_message_attachments_message_id"), table_name="message_attachments")
    op.drop_index(op.f("ix_message_attachments_id"), table_name="message_attachments")
    op.drop_table("message_attachments")

    op.drop_index("ix_conversation_members_user_left_at", table_name="conversation_members")
    op.drop_index("ix_conversation_members_conversation_left_at", table_name="conversation_members")
    op.drop_index(op.f("ix_conversation_members_user_id"), table_name="conversation_members")
    op.drop_index(op.f("ix_conversation_members_conversation_id"), table_name="conversation_members")
    op.drop_index(op.f("ix_conversation_members_id"), table_name="conversation_members")
    op.drop_table("conversation_members")

    op.drop_index("ix_messages_topic_created_at", table_name="messages")
    op.drop_index("ix_messages_conversation_created_at", table_name="messages")
    op.drop_index(op.f("ix_messages_topic_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_sender_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_conversation_id"), table_name="messages")
    op.drop_index(op.f("ix_messages_id"), table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_conversation_topics_conversation_created_at", table_name="conversation_topics")
    op.drop_index(op.f("ix_conversation_topics_created_by_id"), table_name="conversation_topics")
    op.drop_index(op.f("ix_conversation_topics_conversation_id"), table_name="conversation_topics")
    op.drop_index(op.f("ix_conversation_topics_id"), table_name="conversation_topics")
    op.drop_table("conversation_topics")

    op.drop_index(op.f("ix_conversations_created_by_id"), table_name="conversations")
    op.drop_index("ix_conversations_kind_last_message_at", table_name="conversations")
    op.drop_index(op.f("ix_conversations_kind"), table_name="conversations")
    op.drop_index(op.f("ix_conversations_id"), table_name="conversations")
    op.drop_table("conversations")
