from app.models.conversation import Conversation, ConversationMember

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
