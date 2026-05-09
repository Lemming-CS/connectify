from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import Conversation, ConversationMember, ConversationTopic, Message
from app.models.user import User
from app.repositories.conversations import ConversationRepository
from app.repositories.messages import MessageRepository
from app.repositories.users import UserRepository
from app.schemas.messaging import ChatRead, GroupCreate, MessagePage, MessageRead, ReadReceiptRead, TopicRead
from app.services.messaging_permissions import (
    can_change_roles,
    can_manage_members,
    can_manage_message,
    can_manage_topic,
    can_remove_member,
    can_send_messages,
    can_send_topic_messages,
    can_view_topic,
)


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

    def create_group(
        self,
        *,
        current_user: User,
        payload: GroupCreate,
        kind: str,
    ) -> ChatRead:
        if kind not in {"group", "supergroup"}:
            raise ValueError("group creation only supports group and supergroup kinds")

        self._validate_users_exist(payload.member_ids)
        conversation = self.conversations.create_group(
            kind=kind,
            created_by_id=current_user.id,
            title=payload.title,
            description=payload.description,
            avatar_url=payload.avatar_url,
            member_ids=payload.member_ids,
        )
        if kind == "supergroup":
            self.conversations.create_topic(
                conversation_id=conversation.id,
                created_by_id=current_user.id,
                title="General",
                description="Default topic for the supergroup",
                is_general=True,
            )

        self.db.commit()
        refreshed = self.conversations.get_by_id(conversation.id)
        if refreshed is None:
            raise RuntimeError("group was created but could not be reloaded")
        return self._serialize_chat(refreshed)

    def list_chats(self, current_user: User) -> list[ChatRead]:
        conversations = self.conversations.list_for_user(current_user.id)
        return [self._serialize_chat(conversation) for conversation in conversations]

    def add_member(self, *, conversation_id: int, current_user: User, user_id: int) -> ChatRead:
        conversation, actor = self._get_conversation_and_member(conversation_id, current_user.id)
        if not can_manage_members(conversation, actor):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot add members to this chat",
            )
        if conversation.kind == "direct":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Direct chats cannot have additional members",
            )

        target_user = self.users.get_by_id(user_id)
        if target_user is None or not target_user.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        existing = self.conversations.get_member(conversation.id, user_id)
        if existing is not None and existing.left_at is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already a member of this chat",
            )

        self.conversations.add_or_restore_member(conversation.id, user_id)
        self.db.commit()
        refreshed = self.conversations.get_by_id(conversation.id)
        if refreshed is None:
            raise RuntimeError("chat could not be reloaded after adding member")
        return self._serialize_chat(refreshed)

    def remove_member(self, *, conversation_id: int, current_user: User, user_id: int) -> ChatRead:
        conversation, actor = self._get_conversation_and_member(conversation_id, current_user.id)
        target = self.conversations.get_active_member(conversation.id, user_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found",
            )
        if target.role == "owner":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The owner cannot be removed from the chat",
            )

        if actor.user_id == target.user_id:
            pass
        elif not can_remove_member(conversation, actor, target):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot remove this member",
            )

        self.conversations.mark_member_left(target)
        self.db.commit()
        refreshed = self.conversations.get_by_id(conversation.id)
        if refreshed is None:
            raise RuntimeError("chat could not be reloaded after removing member")
        return self._serialize_chat(refreshed)

    def update_member_role(
        self,
        *,
        conversation_id: int,
        current_user: User,
        user_id: int,
        role: str,
    ) -> ChatRead:
        conversation, actor = self._get_conversation_and_member(conversation_id, current_user.id)
        if conversation.kind == "direct":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Direct chats do not support role changes",
            )
        if not can_change_roles(actor):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the owner can change member roles",
            )

        target = self.conversations.get_active_member(conversation.id, user_id)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found",
            )
        if target.role == "owner":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The owner role cannot be changed",
            )
        if target.user_id == actor.user_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The owner cannot change their own role",
            )

        self.conversations.update_member_role(target, role)
        self.db.commit()
        refreshed = self.conversations.get_by_id(conversation.id)
        if refreshed is None:
            raise RuntimeError("chat could not be reloaded after role update")
        return self._serialize_chat(refreshed)

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

    def _validate_users_exist(self, user_ids: list[int]) -> None:
        for user_id in set(user_ids):
            user = self.users.get_by_id(user_id)
            if user is None or not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"User {user_id} not found",
                )

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
            title=conversation.title,
            description=conversation.description,
            avatar_url=conversation.avatar_url,
            created_at=conversation.created_at,
            updated_at=conversation.updated_at,
            last_message_at=conversation.last_message_at,
            members=[
                {
                    "id": member.user.id,
                    "username": member.user.username,
                    "avatar_url": member.user.avatar_url,
                    "status": member.user.status,
                    "role": member.role,
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


class TopicService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.conversations = ConversationRepository(db)

    def create_topic(
        self,
        *,
        conversation_id: int,
        current_user: User,
        title: str,
        description: str | None,
    ) -> TopicRead:
        conversation, member = self._get_supergroup_and_member(conversation_id, current_user.id)
        if not can_manage_topic(conversation, member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot create topics in this supergroup",
            )

        topic = self.conversations.create_topic(
            conversation_id=conversation.id,
            created_by_id=current_user.id,
            title=title,
            description=description,
        )
        self.db.commit()
        self.db.refresh(topic)
        return TopicRead.model_validate(topic)

    def list_topics(self, *, conversation_id: int, current_user: User) -> list[TopicRead]:
        conversation, _ = self._get_supergroup_and_member(conversation_id, current_user.id)
        return [TopicRead.model_validate(topic) for topic in self.conversations.list_topics(conversation.id)]

    def archive_topic(
        self,
        *,
        conversation_id: int,
        topic_id: int,
        current_user: User,
    ) -> TopicRead:
        conversation, member = self._get_supergroup_and_member(conversation_id, current_user.id)
        if not can_manage_topic(conversation, member):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot archive topics in this supergroup",
            )

        topic = self.conversations.get_topic(conversation.id, topic_id)
        if topic is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Topic not found",
            )
        if topic.is_general:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The general topic cannot be archived",
            )

        topic.archived_at = datetime.now(UTC)
        topic.is_closed = True
        self.db.add(topic)
        self.db.commit()
        self.db.refresh(topic)
        return TopicRead.model_validate(topic)

    def _get_supergroup_and_member(
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
        if conversation.kind != "supergroup":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Topics are only available in supergroups",
            )
        member = self.conversations.get_active_member(conversation_id, user_id)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this chat",
            )
        return conversation, member


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
        topic_id: int | None = None,
    ) -> MessagePage:
        conversation, _, topic = self._resolve_context(
            conversation_id=conversation_id,
            user_id=current_user.id,
            topic_id=topic_id,
        )
        messages, has_more = self.messages.list_for_conversation(
            conversation.id,
            before_id=before_id,
            limit=limit,
            topic_id=topic.id if topic is not None else None,
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
        topic_id: int | None = None,
    ) -> tuple[MessageRead, list[int], dict[str, object]]:
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

        message = self.messages.create(conversation.id, current_user.id, body, topic_id=topic.id if topic else None)
        self.db.refresh(message)
        self.conversations.set_last_message(conversation, message)
        self.db.commit()

        refreshed = self.messages.get_by_id(message.id)
        if refreshed is None:
            raise RuntimeError("message was created but could not be reloaded")

        message_read = self._serialize_message(refreshed)
        recipients = self.conversations.get_active_member_ids(conversation.id)
        event = {
            "type": "message.created",
            "conversation_id": conversation.id,
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
        member = self._require_active_member(conversation_id, user_id)

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

    def _require_active_member(self, conversation_id: int, user_id: int) -> ConversationMember:
        member = self.conversations.get_active_member(conversation_id, user_id)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this chat",
            )
        return member

    def _serialize_message(self, message: Message) -> MessageRead:
        return MessageRead.model_validate(message)
