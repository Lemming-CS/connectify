from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.models import Conversation, ConversationMember, ConversationTopic, MessageAttachment
from app.models.user import User
from app.repositories.attachments import AttachmentRepository
from app.repositories.conversations import ConversationRepository
from app.repositories.messages import MessageRepository
from app.schemas.messaging import AttachmentRead, MessageRead
from app.services.media_storage import LocalMediaStorage, StoredMedia
from app.services.messaging_permissions import can_send_messages, can_send_topic_messages, can_view_topic
from app.services.notifications import NotificationService
from app.services.realtime import RealtimeDelivery


class AttachmentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.attachments = AttachmentRepository(db)
        self.conversations = ConversationRepository(db)
        self.messages = MessageRepository(db)
        self.notifications = NotificationService(db)
        self.storage = LocalMediaStorage()

    async def upload_message_attachment(
        self,
        *,
        conversation_id: int,
        current_user: User,
        upload: UploadFile,
        body: str | None,
        is_voice_message: bool,
        topic_id: int | None = None,
    ) -> tuple[MessageRead, list[RealtimeDelivery]]:
        conversation, member, topic = self._resolve_context(
            conversation_id=conversation_id,
            user_id=current_user.id,
            topic_id=topic_id,
        )

        if topic is not None:
            if not can_send_topic_messages(conversation, member, topic):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You cannot send messages in this topic",
                )
        elif not can_send_messages(conversation, member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot send messages in this chat",
            )

        stored = await self.storage.save_upload(
            upload,
            uploader_id=current_user.id,
            is_voice_message=is_voice_message,
        )

        try:
            message = self.messages.create(
                conversation.id,
                current_user.id,
                body or None,
                topic_id=topic.id if topic is not None else None,
            )
            self.attachments.create(
                message_id=message.id,
                uploader_id=current_user.id,
                kind=stored.kind,
                is_voice_message=is_voice_message,
                storage_key=stored.storage_key,
                original_filename=stored.original_filename,
                content_type=stored.content_type,
                size_bytes=stored.size_bytes,
                checksum_sha256=stored.checksum_sha256,
                width=stored.width,
                height=stored.height,
                duration_seconds=stored.duration_seconds,
            )
            self.conversations.set_last_message(conversation, message)
            notification_deliveries = self.notifications.create_message_notifications(
                conversation=conversation,
                message=message,
                sender=current_user,
                body=body,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            self.storage.delete(stored.storage_key)
            raise

        refreshed = self.messages.get_by_id(message.id)
        if refreshed is None:
            self.storage.delete(stored.storage_key)
            raise RuntimeError("message attachment was created but could not be reloaded")

        message_read = self._serialize_message(refreshed)
        deliveries = [
            RealtimeDelivery(
                recipients=self.conversations.get_active_member_ids(conversation.id),
                event={
                    "type": "message.created",
                    "conversation_id": conversation.id,
                    "payload": message_read.model_dump(mode="json"),
                },
            ),
            *notification_deliveries,
        ]
        return message_read, deliveries

    def get_attachment_file(
        self,
        *,
        attachment_id: int,
        current_user: User,
    ) -> tuple[MessageAttachment, Path]:
        attachment = self.attachments.get_by_id(attachment_id)
        if attachment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment not found",
            )
        if attachment.message is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment not found",
            )

        member = self.conversations.get_active_member(
            attachment.message.conversation_id,
            current_user.id,
        )
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this media",
            )

        path = self.storage.resolve_storage_path(attachment.storage_key)
        if not path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attachment file is missing",
            )
        return attachment, path

    def serialize_attachment(self, attachment: MessageAttachment) -> AttachmentRead:
        return AttachmentRead(
            id=attachment.id,
            kind=attachment.kind,
            is_voice_message=attachment.is_voice_message,
            original_filename=attachment.original_filename,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            checksum_sha256=attachment.checksum_sha256,
            width=attachment.width,
            height=attachment.height,
            duration_seconds=attachment.duration_seconds,
            created_at=attachment.created_at,
            media_url=f"/api/v1/media/attachments/{attachment.id}",
        )

    def _serialize_message(self, message) -> MessageRead:
        return MessageRead(
            id=message.id,
            conversation_id=message.conversation_id,
            topic_id=message.topic_id,
            sender={
                "id": message.sender.id,
                "username": message.sender.username,
                "avatar_url": message.sender.avatar_url,
            },
            body=message.body,
            attachments=[self.serialize_attachment(item) for item in message.attachments],
            created_at=message.created_at,
            edited_at=message.edited_at,
            deleted_at=message.deleted_at,
        )

    def _resolve_context(
        self,
        *,
        conversation_id: int,
        user_id: int,
        topic_id: int | None,
    ) -> tuple[Conversation, ConversationMember, ConversationTopic | None]:
        conversation = self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        member = self.conversations.get_active_member(conversation_id, user_id)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this chat",
            )

        if topic_id is None:
            if conversation.kind == "supergroup":
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Use a topic endpoint for supergroup messages",
                )
            return conversation, member, None

        if conversation.kind != "supergroup":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Topics are only available in supergroups",
            )

        topic = self.conversations.get_topic(conversation_id, topic_id)
        if not can_view_topic(conversation, member, topic):
            if topic is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Topic not found",
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this topic",
            )
        return conversation, member, topic
