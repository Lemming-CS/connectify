from app.models.conversation import Conversation, ConversationMember
from app.models.conversation import ConversationTopic
from app.models.message import Message

MANAGE_ROLES = {"owner", "admin"}


def is_active_member(member: ConversationMember | None) -> bool:
    return member is not None and member.left_at is None


def can_view_conversation(member: ConversationMember | None) -> bool:
    return is_active_member(member)


def can_send_messages(conversation: Conversation, member: ConversationMember | None) -> bool:
    return conversation.is_active is not False and is_active_member(member)


def can_manage_members(conversation: Conversation, member: ConversationMember | None) -> bool:
    if conversation.kind == "direct":
        return False
    return (
        conversation.is_active is not False
        and is_active_member(member)
        and member.role in MANAGE_ROLES
    )


def can_manage_topics(conversation: Conversation, member: ConversationMember | None) -> bool:
    if conversation.kind != "supergroup":
        return False
    return (
        conversation.is_active is not False
        and is_active_member(member)
        and member.role in MANAGE_ROLES
    )


def can_remove_member(
    conversation: Conversation,
    actor: ConversationMember | None,
    target: ConversationMember | None,
) -> bool:
    if not can_manage_members(conversation, actor):
        return False
    if not is_active_member(target):
        return False
    if actor is None or target is None:
        return False
    if actor.user_id == target.user_id:
        return True
    if actor.role == "owner":
        return True
    if actor.role == "admin":
        return target.role == "member"
    return False


def can_manage_message(
    conversation: Conversation,
    actor: ConversationMember | None,
    message: Message,
) -> bool:
    if not can_view_conversation(actor):
        return False
    if actor is None:
        return False
    if actor.user_id == message.sender_id:
        return True
    if conversation.kind == "direct":
        return False
    return actor.role in MANAGE_ROLES


def can_change_roles(actor: ConversationMember | None) -> bool:
    return is_active_member(actor) and actor.role == "owner"


def can_view_topic(
    conversation: Conversation,
    member: ConversationMember | None,
    topic: ConversationTopic | None,
) -> bool:
    return (
        topic is not None
        and conversation.kind == "supergroup"
        and can_view_conversation(member)
    )


def can_manage_topic(
    conversation: Conversation,
    member: ConversationMember | None,
) -> bool:
    return can_manage_topics(conversation, member)


def can_send_topic_messages(
    conversation: Conversation,
    member: ConversationMember | None,
    topic: ConversationTopic | None,
) -> bool:
    if not can_view_topic(conversation, member, topic):
        return False
    if topic is None or topic.archived_at is not None:
        return False
    if topic.is_closed:
        return member is not None and member.role in MANAGE_ROLES
    return can_send_messages(conversation, member)
