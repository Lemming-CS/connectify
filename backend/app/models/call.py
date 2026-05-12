from datetime import datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

CALL_KINDS = ("audio", "video")
CALL_STATUSES = ("ringing", "active", "rejected", "ended", "canceled")


class CallSession(Base):
    __tablename__ = "call_sessions"
    __table_args__ = (
        CheckConstraint(
            f"kind IN {CALL_KINDS}",
            name="ck_call_sessions_kind",
        ),
        CheckConstraint(
            f"status IN {CALL_STATUSES}",
            name="ck_call_sessions_status",
        ),
        Index("ix_call_sessions_conversation_created_at", "conversation_id", "created_at"),
        Index("ix_call_sessions_conversation_status", "conversation_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False, index=True)
    caller_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    callee_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    ended_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ringing", nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    conversation = relationship("Conversation")
    caller = relationship("User", foreign_keys=[caller_id], back_populates="calls_started")
    callee = relationship("User", foreign_keys=[callee_id], back_populates="calls_received")
    ended_by = relationship("User", foreign_keys=[ended_by_id], back_populates="calls_ended")
