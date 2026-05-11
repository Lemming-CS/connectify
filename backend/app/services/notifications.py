import re
from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Conversation, Message, Notification
from app.models.user import User
from app.repositories.conversations import ConversationRepository
from app.repositories.notifications import NotificationRepository
from app.repositories.users import UserRepository
from app.schemas.notifications import NotificationRead

MENTION_PATTERN = re.compile(r"(?<!\w)@([A-Za-z0-9_]{1,32})\b")


@dataclass(frozen=True)
class RealtimeDelivery:
    recipients: list[int]
    event: dict[str, object]


class NotificationService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.notifications = NotificationRepository(db)
        self.conversations = ConversationRepository(db)
        self.users = UserRepository(db)

    def list_notifications(self, *, current_user: User, unread_only: bool = True) -> list[NotificationRead]:
        items = self.notifications.list_for_user(current_user.id, unread_only=unread_only)
        return [self._serialize_notification(item) for item in items]

    def mark_read(
        self,
        *,
        current_user: User,
        notification_id: int,
    ) -> tuple[NotificationRead, list[RealtimeDelivery]]:
        notification = self.notifications.get_for_user(notification_id, current_user.id)
        if notification is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found",
            )

        self.notifications.mark_read(notification)
        self.db.commit()
        refreshed = self.notifications.get_for_user(notification.id, current_user.id)
        if refreshed is None:
            raise RuntimeError("notification was marked read but could not be reloaded")

        notification_read = self._serialize_notification(refreshed)
        deliveries = [
            RealtimeDelivery(
                recipients=[current_user.id],
                event={
                    "type": "notification.read",
                    "payload": notification_read.model_dump(mode="json"),
                },
            )
        ]
        return notification_read, deliveries

    def mark_all_read(self, *, current_user: User) -> tuple[list[NotificationRead], list[RealtimeDelivery]]:
        notifications = self.notifications.mark_all_read_for_user(current_user.id)
        self.db.commit()
        serialized = [self._serialize_notification(item) for item in notifications]
        deliveries: list[RealtimeDelivery] = []
        if serialized:
            deliveries.append(
                RealtimeDelivery(
                    recipients=[current_user.id],
                    event={
                        "type": "notification.read_all",
                        "payload": {
                            "notification_ids": [item.id for item in serialized],
                        },
                    },
                )
            )
        return serialized, deliveries

    def clear_notification(
        self,
        *,
        current_user: User,
        notification_id: int,
    ) -> tuple[int, list[RealtimeDelivery]]:
        notification = self.notifications.get_for_user(notification_id, current_user.id)
        if notification is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found",
            )

        deleted_id = notification.id
        self.notifications.delete_for_user(notification)
        self.db.commit()
        deliveries = [
            RealtimeDelivery(
                recipients=[current_user.id],
                event={
                    "type": "notification.cleared",
                    "payload": {
                        "notification_ids": [deleted_id],
                    },
                },
            )
        ]
        return 1, deliveries

    def clear_all_notifications(self, *, current_user: User) -> tuple[int, list[RealtimeDelivery]]:
        cleared_count = self.notifications.delete_all_for_user(current_user.id)
        self.db.commit()
        deliveries: list[RealtimeDelivery] = []
        if cleared_count:
            deliveries.append(
                RealtimeDelivery(
                    recipients=[current_user.id],
                    event={
                        "type": "notification.cleared_all",
                        "payload": {
                            "cleared_count": cleared_count,
                        },
                    },
                )
            )
        return cleared_count, deliveries

    def create_group_invite_notifications(
        self,
        *,
        conversation: Conversation,
        actor: User,
        recipient_ids: list[int],
    ) -> list[RealtimeDelivery]:
        unique_recipient_ids = sorted({user_id for user_id in recipient_ids if user_id != actor.id})
        if not unique_recipient_ids:
            return []

        notifications: list[Notification] = []
        for recipient_id in unique_recipient_ids:
            notifications.append(
                self.notifications.create(
                    recipient_id=recipient_id,
                    actor_id=actor.id,
                    conversation_id=conversation.id,
                    kind="group_invite",
                    data={
                        "conversation_kind": conversation.kind,
                        "conversation_title": conversation.title,
                    },
                )
            )
        self.db.flush()
        return self._created_notification_deliveries(notifications)

    def create_group_membership_removed_notification(
        self,
        *,
        conversation: Conversation,
        actor: User,
        recipient_id: int,
    ) -> list[RealtimeDelivery]:
        if recipient_id == actor.id:
            return []

        notification = self.notifications.create(
            recipient_id=recipient_id,
            actor_id=actor.id,
            conversation_id=conversation.id,
            kind="group_member_removed",
            data={
                "conversation_kind": conversation.kind,
                "conversation_title": conversation.title,
            },
        )
        self.db.flush()
        return self._created_notification_deliveries([notification])

    def create_group_role_changed_notification(
        self,
        *,
        conversation: Conversation,
        actor: User,
        recipient_id: int,
        role: str,
    ) -> list[RealtimeDelivery]:
        if recipient_id == actor.id:
            return []

        notification = self.notifications.create(
            recipient_id=recipient_id,
            actor_id=actor.id,
            conversation_id=conversation.id,
            kind="group_role_changed",
            data={
                "conversation_kind": conversation.kind,
                "conversation_title": conversation.title,
                "role": role,
            },
        )
        self.db.flush()
        return self._created_notification_deliveries([notification])

    def create_message_notifications(
        self,
        *,
        conversation: Conversation,
        message: Message,
        sender: User,
        body: str | None,
    ) -> list[RealtimeDelivery]:
        recipient_ids = [
            user_id
            for user_id in self.conversations.get_active_member_ids(conversation.id)
            if user_id != sender.id
        ]
        if not recipient_ids:
            return []

        mentioned_user_ids = self._extract_mentioned_user_ids(conversation.id, body)
        notifications: list[Notification] = []
        for recipient_id in recipient_ids:
            kind = "message_mention" if recipient_id in mentioned_user_ids else "message_new"
            notifications.append(
                self.notifications.create(
                    recipient_id=recipient_id,
                    actor_id=sender.id,
                    conversation_id=conversation.id,
                    message_id=message.id,
                    kind=kind,
                    data={
                        "conversation_kind": conversation.kind,
                        "conversation_title": conversation.title,
                        "message_preview": self._message_preview(body),
                        "topic_id": message.topic_id,
                    },
                )
            )
        self.db.flush()
        return self._created_notification_deliveries(notifications)

    def _created_notification_deliveries(self, notifications: list[Notification]) -> list[RealtimeDelivery]:
        deliveries: list[RealtimeDelivery] = []
        for notification in notifications:
            self.db.refresh(notification)
            deliveries.append(
                RealtimeDelivery(
                    recipients=[notification.recipient_id],
                    event={
                        "type": "notification.created",
                        "payload": self._serialize_notification(notification).model_dump(mode="json"),
                    },
                )
            )
        return deliveries

    def _extract_mentioned_user_ids(self, conversation_id: int, body: str | None) -> set[int]:
        if not body:
            return set()

        usernames = {match.group(1) for match in MENTION_PATTERN.finditer(body)}
        if not usernames:
            return set()

        mentioned_ids: set[int] = set()
        for username in usernames:
            user = self.users.get_by_username(username)
            if user is None:
                continue
            member = self.conversations.get_active_member(conversation_id, user.id)
            if member is not None:
                mentioned_ids.add(user.id)
        return mentioned_ids

    def _message_preview(self, body: str | None) -> str | None:
        if body is None:
            return None
        preview = body.strip()
        if not preview:
            return None
        if len(preview) <= 120:
            return preview
        return f"{preview[:117]}..."

    def _serialize_notification(self, notification: Notification) -> NotificationRead:
        actor = None
        if notification.actor is not None:
            actor = {
                "id": notification.actor.id,
                "username": notification.actor.username,
                "avatar_url": notification.actor.avatar_url,
            }

        return NotificationRead(
            id=notification.id,
            kind=notification.kind,
            recipient_id=notification.recipient_id,
            conversation_id=notification.conversation_id,
            message_id=notification.message_id,
            actor=actor,
            data=notification.data or {},
            is_read=notification.is_read,
            read_at=notification.read_at,
            created_at=notification.created_at,
        )
