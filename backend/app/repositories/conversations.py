from datetime import UTC, datetime

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Conversation, ConversationMember, ConversationTopic, Message


class ConversationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, conversation_id: int) -> Conversation | None:
        return self.db.scalar(self._conversation_with_members().where(Conversation.id == conversation_id))

    def get_with_topics(self, conversation_id: int) -> Conversation | None:
        stmt = select(Conversation).where(Conversation.id == conversation_id).options(
            selectinload(Conversation.members).selectinload(ConversationMember.user),
            selectinload(Conversation.topics),
        )
        return self.db.scalar(stmt)

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

    def get_member(self, conversation_id: int, user_id: int) -> ConversationMember | None:
        stmt = (
            select(ConversationMember)
            .where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
            )
            .options(selectinload(ConversationMember.user))
        )
        return self.db.scalar(stmt)

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

    def create_group(
        self,
        *,
        kind: str,
        created_by_id: int,
        title: str,
        description: str | None,
        avatar_url: str | None,
        member_ids: list[int],
    ) -> Conversation:
        conversation = Conversation(
            kind=kind,
            title=title,
            description=description,
            avatar_url=avatar_url,
            created_by_id=created_by_id,
        )
        self.db.add(conversation)
        self.db.flush()

        seen_user_ids: set[int] = set()
        for user_id in [created_by_id, *member_ids]:
            if user_id in seen_user_ids:
                continue
            seen_user_ids.add(user_id)
            self.db.add(
                ConversationMember(
                    conversation_id=conversation.id,
                    user_id=user_id,
                    role="owner" if user_id == created_by_id else "member",
                )
            )

        self.db.flush()
        return conversation

    def add_or_restore_member(self, conversation_id: int, user_id: int) -> ConversationMember:
        member = self.get_member(conversation_id, user_id)
        if member is None:
            member = ConversationMember(
                conversation_id=conversation_id,
                user_id=user_id,
                role="member",
            )
        else:
            member.left_at = None
            member.role = "member"
            member.joined_at = datetime.now(UTC)
        self.db.add(member)
        self.db.flush()
        return member

    def mark_member_left(self, member: ConversationMember) -> ConversationMember:
        member.left_at = datetime.now(UTC)
        self.db.add(member)
        self.db.flush()
        return member

    def update_member_role(self, member: ConversationMember, role: str) -> ConversationMember:
        member.role = role
        self.db.add(member)
        self.db.flush()
        return member

    def create_topic(
        self,
        *,
        conversation_id: int,
        created_by_id: int,
        title: str,
        description: str | None,
        is_general: bool = False,
    ) -> ConversationTopic:
        topic = ConversationTopic(
            conversation_id=conversation_id,
            created_by_id=created_by_id,
            title=title,
            description=description,
            is_general=is_general,
        )
        self.db.add(topic)
        self.db.flush()
        return topic

    def get_topic(self, conversation_id: int, topic_id: int) -> ConversationTopic | None:
        stmt = select(ConversationTopic).where(
            ConversationTopic.id == topic_id,
            ConversationTopic.conversation_id == conversation_id,
        )
        return self.db.scalar(stmt)

    def list_topics(self, conversation_id: int) -> list[ConversationTopic]:
        stmt = (
            select(ConversationTopic)
            .where(ConversationTopic.conversation_id == conversation_id)
            .order_by(
                ConversationTopic.is_general.desc(),
                ConversationTopic.created_at.asc(),
                ConversationTopic.id.asc(),
            )
        )
        return list(self.db.scalars(stmt))

    def set_last_message(self, conversation: Conversation, message: Message | None) -> None:
        conversation.last_message_at = None if message is None else message.created_at
        self.db.add(conversation)

    def _conversation_with_members(self) -> Select[tuple[Conversation]]:
        return select(Conversation).options(
            selectinload(Conversation.members).selectinload(ConversationMember.user),
        )
