from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Conversation, ConversationMember, Message
from app.models.user import User
from app.repositories.conversations import ConversationRepository
from app.repositories.messages import MessageRepository
from app.repositories.users import UserRepository
from app.schemas.messaging import ChatRead, MessagePage, MessageRead, ReadReceiptRead
from app.services.messaging_permissions import can_manage_message, can_send_messages


class ChatService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.conversations = ConversationRepository(db)
        self.users = UserRepository(db)
        self.messages = MessageRepository(db)

    def create_direct_chat(self, current_user: User, participant_id: int) -> tuple[ChatRead, bool]:
        if participant_id == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create a direct chat with yourself",
            )

        participant = self.users.get_by_id(participant_id)
        if participant is None or not participant.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Participant not found",
            )

        existing = self.conversations.get_direct_between(current_user.id, participant_id)
        if existing is not None:
            return self._serialize_chat(existing), False

        conversation = self.conversations.create_direct(
            created_by_id=current_user.id,
            participant_ids=(current_user.id, participant_id),
        )
        self.db.commit()
        refreshed = self.conversations.get_by_id(conversation.id)
        if refreshed is None:
            raise RuntimeError("direct chat was created but could not be reloaded")
        return self._serialize_chat(refreshed), True

    def list_chats(self, current_user: User) -> list[ChatRead]:
        conversations = self.conversations.list_for_user(current_user.id)
        return [self._serialize_chat(conversation) for conversation in conversations]

    def mark_read(
        self,
        *,
        conversation_id: int,
        current_user: User,
        message_id: int | None,
    ) -> tuple[ReadReceiptRead, list[int], dict[str, object]]:
        conversation, member = self._get_conversation_and_member(conversation_id, current_user.id)

        target_message = None
        if message_id is not None:
            target_message = self.messages.get_for_conversation(conversation.id, message_id)
            if target_message is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Message not found",
                )
        else:
            target_message = self.messages.get_latest_for_conversation(conversation.id)

        if target_message is not None:
            current_last_id = member.last_read_message_id or 0
            if target_message.id > current_last_id:
                member.last_read_message_id = target_message.id
                member.last_read_at = datetime.now(UTC)
                self.db.add(member)
                self.db.commit()
                self.db.refresh(member)

        receipt = self._serialize_read_receipt(member)
        recipients = self.conversations.get_active_member_ids(conversation.id)
        event = {
            "type": "message.read",
            "conversation_id": conversation.id,
            "payload": receipt.model_dump(mode="json"),
        }
        return receipt, recipients, event

    def publish_typing(
        self,
        *,
        conversation_id: int,
        current_user: User,
        is_typing: bool,
    ) -> tuple[list[int], dict[str, object]]:
        conversation, member = self._get_conversation_and_member(conversation_id, current_user.id)
        if not can_send_messages(conversation, member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not allowed to send typing indicators in this chat",
            )

        recipients = [
            user_id
            for user_id in self.conversations.get_active_member_ids(conversation.id)
            if user_id != current_user.id
        ]
        event = {
            "type": "typing",
            "conversation_id": conversation.id,
            "payload": {
                "user_id": current_user.id,
                "username": current_user.username,
                "is_typing": is_typing,
            },
        }
        return recipients, event

    def _get_conversation_and_member(
        self,
        conversation_id: int,
        user_id: int,
    ) -> tuple[Conversation, ConversationMember]:
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
        return conversation, member

    def _serialize_chat(self, conversation: Conversation) -> ChatRead:
        active_members = [member for member in conversation.members if member.left_at is None]
        return ChatRead(
            id=conversation.id,
            kind=conversation.kind,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            members=[
                {
                    "id": member.user.id,
                    "username": member.user.username,
                    "avatar_url": member.user.avatar_url,
                    "status": member.user.status,
                }
                for member in active_members
            ],
            read_states=[self._serialize_read_receipt(member) for member in active_members],
        )

    def _serialize_read_receipt(self, member: ConversationMember) -> ReadReceiptRead:
        return ReadReceiptRead(
            user_id=member.user_id,
            username=member.user.username if member.user is not None else "",
            last_read_message_id=member.last_read_message_id,
            last_read_at=member.last_read_at,
        )


class MessageService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.conversations = ConversationRepository(db)
        self.messages = MessageRepository(db)

    def list_messages(
        self,
        *,
        conversation_id: int,
        current_user: User,
        before_id: int | None,
        limit: int,
    ) -> MessagePage:
        self._require_active_member(conversation_id, current_user.id)
        messages, has_more = self.messages.list_for_conversation(
            conversation_id,
            before_id=before_id,
            limit=limit,
        )
        next_before_id = messages[0].id if has_more and messages else None
        return MessagePage(
            items=[self._serialize_message(message) for message in messages],
            next_before_id=next_before_id,
        )

    def send_message(
        self,
        *,
        conversation_id: int,
        current_user: User,
        body: str,
    ) -> tuple[MessageRead, list[int], dict[str, object]]:
        conversation = self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        member = self._require_active_member(conversation_id, current_user.id)
        if not can_send_messages(conversation, member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot send messages in this chat",
            )

        message = self.messages.create(conversation_id, current_user.id, body)
        self.db.refresh(message)
        self.conversations.set_last_message(conversation, message)
        self.db.commit()

        refreshed = self.messages.get_by_id(message.id)
        if refreshed is None:
            raise RuntimeError("message was created but could not be reloaded")

        message_read = self._serialize_message(refreshed)
        recipients = self.conversations.get_active_member_ids(conversation_id)
        event = {
            "type": "message.created",
            "conversation_id": conversation_id,
            "payload": message_read.model_dump(mode="json"),
        }
        return message_read, recipients, event

    def edit_message(
        self,
        *,
        conversation_id: int,
        message_id: int,
        current_user: User,
        body: str,
    ) -> tuple[MessageRead, list[int], dict[str, object]]:
        conversation = self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        member = self._require_active_member(conversation_id, current_user.id)
        message = self.messages.get_for_conversation(conversation_id, message_id)
        if message is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found",
            )
        if message.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Deleted messages cannot be edited",
            )
        if not can_manage_message(conversation, member, message):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot edit this message",
            )

        message.body = body
        message.edited_at = datetime.now(UTC)
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)

        message_read = self._serialize_message(message)
        recipients = self.conversations.get_active_member_ids(conversation_id)
        event = {
            "type": "message.updated",
            "conversation_id": conversation_id,
            "payload": message_read.model_dump(mode="json"),
        }
        return message_read, recipients, event

    def delete_message(
        self,
        *,
        conversation_id: int,
        message_id: int,
        current_user: User,
    ) -> tuple[MessageRead, list[int], dict[str, object]]:
        conversation = self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        member = self._require_active_member(conversation_id, current_user.id)
        message = self.messages.get_for_conversation(conversation_id, message_id)
        if message is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found",
            )
        if not can_manage_message(conversation, member, message):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot delete this message",
            )

        message.body = None
        message.deleted_at = datetime.now(UTC)
        self.db.add(message)
        self.db.commit()
        self.db.refresh(message)

        message_read = self._serialize_message(message)
        recipients = self.conversations.get_active_member_ids(conversation_id)
        event = {
            "type": "message.deleted",
            "conversation_id": conversation_id,
            "payload": message_read.model_dump(mode="json"),
        }
        return message_read, recipients, event

    def _require_active_member(self, conversation_id: int, user_id: int) -> ConversationMember:
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
        return member

    def _serialize_message(self, message: Message) -> MessageRead:
        return MessageRead.model_validate(message)
