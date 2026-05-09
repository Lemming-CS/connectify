from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Message


class MessageRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, message_id: int) -> Message | None:
        stmt = (
            select(Message)
            .where(Message.id == message_id)
            .options(selectinload(Message.sender))
        )
        return self.db.scalar(stmt)

    def get_for_conversation(self, conversation_id: int, message_id: int) -> Message | None:
        stmt = (
            select(Message)
            .where(
                Message.id == message_id,
                Message.conversation_id == conversation_id,
            )
            .options(selectinload(Message.sender))
        )
        return self.db.scalar(stmt)

    def list_for_conversation(
        self,
        conversation_id: int,
        *,
        before_id: int | None,
        limit: int,
        topic_id: int | None = None,
    ) -> tuple[list[Message], bool]:
        stmt = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .options(selectinload(Message.sender))
            .order_by(Message.id.desc())
            .limit(limit + 1)
        )
        if before_id is not None:
            stmt = stmt.where(Message.id < before_id)
        if topic_id is not None:
            stmt = stmt.where(Message.topic_id == topic_id)
        elif topic_id is None:
            stmt = stmt.where(Message.topic_id.is_(None))

        results = list(self.db.scalars(stmt))
        has_more = len(results) > limit
        page = results[:limit]
        page.reverse()
        return page, has_more

    def get_latest_for_conversation(self, conversation_id: int) -> Message | None:
        stmt = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .options(selectinload(Message.sender))
            .order_by(Message.id.desc())
            .limit(1)
        )
        return self.db.scalar(stmt)

    def create(
        self,
        conversation_id: int,
        sender_id: int,
        body: str,
        *,
        topic_id: int | None = None,
    ) -> Message:
        message = Message(
            conversation_id=conversation_id,
            topic_id=topic_id,
            sender_id=sender_id,
            body=body,
        )
        self.db.add(message)
        self.db.flush()
        return message
