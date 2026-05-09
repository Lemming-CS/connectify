from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

ATTACHMENT_KINDS = ("file", "image", "video", "audio")
ATTACHMENT_STATUSES = ("pending", "ready", "failed")
MESSAGE_KINDS = ("text", "system", "call")


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint(
            f"kind IN {MESSAGE_KINDS}",
            name="ck_messages_kind",
        ),
        Index("ix_messages_conversation_created_at", "conversation_id", "created_at"),
        Index("ix_messages_topic_created_at", "topic_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False, index=True)
    topic_id: Mapped[int | None] = mapped_column(ForeignKey("conversation_topics.id"), nullable=True, index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    reply_to_message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="text", nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    conversation = relationship("Conversation", back_populates="messages")
    topic = relationship("ConversationTopic", back_populates="messages")
    sender = relationship("User", foreign_keys=[sender_id], back_populates="messages_sent")
    reply_to_message = relationship("Message", remote_side=[id])
    attachments = relationship(
        "MessageAttachment",
        back_populates="message",
        cascade="all, delete-orphan",
    )


class MessageAttachment(Base):
    __tablename__ = "message_attachments"
    __table_args__ = (
        CheckConstraint(
            f"kind IN {ATTACHMENT_KINDS}",
            name="ck_message_attachments_kind",
        ),
        CheckConstraint(
            f"status IN {ATTACHMENT_STATUSES}",
            name="ck_message_attachments_status",
        ),
        Index("ix_message_attachments_message_created_at", "message_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id"), nullable=False, index=True)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), default="file", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ready", nullable=False)
    is_voice_message: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    message = relationship("Message", back_populates="attachments")
    uploader = relationship("User", foreign_keys=[uploader_id], back_populates="attachments_uploaded")
