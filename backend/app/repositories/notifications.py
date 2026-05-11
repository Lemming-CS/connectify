from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.models import Notification


class NotificationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_for_user(self, recipient_id: int, *, unread_only: bool = True) -> list[Notification]:
        stmt = self._base_query().where(Notification.recipient_id == recipient_id)
        if unread_only:
            stmt = stmt.where(Notification.is_read.is_(False))
        stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        return list(self.db.scalars(stmt))

    def get_for_user(self, notification_id: int, recipient_id: int) -> Notification | None:
        stmt = self._base_query().where(
            Notification.id == notification_id,
            Notification.recipient_id == recipient_id,
        )
        return self.db.scalar(stmt)

    def create(
        self,
        *,
        recipient_id: int,
        kind: str,
        actor_id: int | None = None,
        conversation_id: int | None = None,
        message_id: int | None = None,
        data: dict[str, object] | None = None,
    ) -> Notification:
        notification = Notification(
            recipient_id=recipient_id,
            actor_id=actor_id,
            conversation_id=conversation_id,
            message_id=message_id,
            kind=kind,
            data=data or {},
        )
        self.db.add(notification)
        self.db.flush()
        return notification

    def mark_read(self, notification: Notification) -> Notification:
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = datetime.now(UTC)
            self.db.add(notification)
            self.db.flush()
        return notification

    def mark_all_read_for_user(self, recipient_id: int) -> list[Notification]:
        notifications = self.list_for_user(recipient_id, unread_only=True)
        timestamp = datetime.now(UTC)
        for notification in notifications:
            notification.is_read = True
            notification.read_at = timestamp
            self.db.add(notification)
        self.db.flush()
        return notifications

    def delete_for_user(self, notification: Notification) -> None:
        self.db.delete(notification)
        self.db.flush()

    def delete_all_for_user(self, recipient_id: int) -> int:
        stmt = delete(Notification).where(Notification.recipient_id == recipient_id)
        result = self.db.execute(stmt)
        self.db.flush()
        return int(result.rowcount or 0)

    def _base_query(self):
        return select(Notification).options(selectinload(Notification.actor))
