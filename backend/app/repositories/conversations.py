from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Conversation, ConversationMember, Message


class ConversationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, conversation_id: int) -> Conversation | None:
        return self.db.scalar(self._conversation_with_members().where(Conversation.id == conversation_id))

    def get_direct_between(self, first_user_id: int, second_user_id: int) -> Conversation | None:
        member_ids = sorted({first_user_id, second_user_id})
        stmt = (
            self._conversation_with_members()
            .join(ConversationMember)
            .where(
                Conversation.kind == "direct",
                ConversationMember.left_at.is_(None),
                ConversationMember.user_id.in_(member_ids),
            )
            .group_by(Conversation.id)
            .having(func.count(ConversationMember.id) == 2)
        )
        return self.db.scalar(stmt)

    def list_for_user(self, user_id: int) -> list[Conversation]:
        stmt = (
            self._conversation_with_members()
            .join(ConversationMember)
            .where(
                ConversationMember.user_id == user_id,
                ConversationMember.left_at.is_(None),
            )
            .order_by(
                func.coalesce(Conversation.last_message_at, Conversation.created_at).desc(),
                Conversation.id.desc(),
            )
        )
        return list(self.db.scalars(stmt).unique())

    def get_active_member(self, conversation_id: int, user_id: int) -> ConversationMember | None:
        stmt = (
            select(ConversationMember)
            .where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
                ConversationMember.left_at.is_(None),
            )
            .options(selectinload(ConversationMember.user))
        )
        return self.db.scalar(stmt)

    def get_active_member_ids(self, conversation_id: int) -> list[int]:
        stmt = select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.left_at.is_(None),
        )
        return list(self.db.scalars(stmt))

    def create_direct(self, created_by_id: int, participant_ids: tuple[int, int]) -> Conversation:
        conversation = Conversation(kind="direct", created_by_id=created_by_id)
        self.db.add(conversation)
        self.db.flush()

        for index, user_id in enumerate(participant_ids):
            role = "owner" if index == 0 else "member"
            self.db.add(
                ConversationMember(
                    conversation_id=conversation.id,
                    user_id=user_id,
                    role=role,
                )
            )
        self.db.flush()
        return conversation

    def set_last_message(self, conversation: Conversation, message: Message | None) -> None:
        conversation.last_message_at = None if message is None else message.created_at
        self.db.add(conversation)

    def _conversation_with_members(self) -> Select[tuple[Conversation]]:
        return select(Conversation).options(
            selectinload(Conversation.members).selectinload(ConversationMember.user),
        )
