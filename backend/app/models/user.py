from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="offline", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    conversations_created = relationship(
        "Conversation",
        foreign_keys="Conversation.created_by_id",
        back_populates="creator",
    )
    conversation_memberships = relationship(
        "ConversationMember",
        foreign_keys="ConversationMember.user_id",
        back_populates="user",
    )
    topics_created = relationship(
        "ConversationTopic",
        foreign_keys="ConversationTopic.created_by_id",
        back_populates="creator",
    )
    messages_sent = relationship("Message", foreign_keys="Message.sender_id", back_populates="sender")
    attachments_uploaded = relationship(
        "MessageAttachment",
        foreign_keys="MessageAttachment.uploader_id",
        back_populates="uploader",
    )
