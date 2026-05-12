from datetime import UTC, datetime

from app.models import CallSession, Conversation, ConversationMember, ConversationTopic, Message, MessageAttachment, Notification, User
from app.services.messaging_permissions import (
    can_manage_members,
    can_manage_topics,
    can_remove_member,
    can_send_messages,
    can_view_conversation,
)


def make_user(email: str, username: str) -> User:
    return User(
        email=email,
        username=username,
        hashed_password="hashed-password",
        status="offline",
    )


def test_messaging_relationships_support_topics_attachments_and_read_state(db_session) -> None:
    owner = make_user("owner@example.com", "owner")
    member = make_user("member@example.com", "member")
    db_session.add_all([owner, member])
    db_session.flush()

    conversation = Conversation(
        kind="supergroup",
        title="Platform",
        created_by_id=owner.id,
    )
    db_session.add(conversation)
    db_session.flush()

    owner_membership = ConversationMember(
        conversation_id=conversation.id,
        user_id=owner.id,
        role="owner",
    )
    member_membership = ConversationMember(
        conversation_id=conversation.id,
        user_id=member.id,
        role="member",
    )
    topic = ConversationTopic(
        conversation_id=conversation.id,
        created_by_id=owner.id,
        title="Releases",
        is_general=True,
    )
    db_session.add_all([owner_membership, member_membership, topic])
    db_session.flush()

    message = Message(
        conversation_id=conversation.id,
        topic_id=topic.id,
        sender_id=owner.id,
        body="v1 ships today",
    )
    db_session.add(message)
    db_session.flush()

    attachment = MessageAttachment(
        message_id=message.id,
        uploader_id=owner.id,
        kind="image",
        status="ready",
        storage_key="attachments/platform/release.png",
        original_filename="release.png",
        content_type="image/png",
        size_bytes=2048,
        width=1024,
        height=768,
    )
    notification = Notification(
        recipient_id=member.id,
        actor_id=owner.id,
        conversation_id=conversation.id,
        message_id=message.id,
        kind="message_new",
        data={"message_preview": "v1 ships today"},
    )
    member_membership.last_read_message_id = message.id
    member_membership.last_read_at = datetime.now(UTC)
    db_session.add_all([attachment, notification])
    db_session.commit()

    persisted = db_session.get(Conversation, conversation.id)
    assert persisted is not None
    assert persisted.creator.username == "owner"
    assert {membership.role for membership in persisted.members} == {"owner", "member"}
    assert persisted.topics[0].title == "Releases"
    assert persisted.messages[0].topic is not None
    assert persisted.messages[0].topic.title == "Releases"
    assert persisted.messages[0].attachments[0].storage_key == "attachments/platform/release.png"

    refreshed_member = db_session.get(ConversationMember, member_membership.id)
    assert refreshed_member is not None
    assert refreshed_member.last_read_message is not None
    assert refreshed_member.last_read_message.body == "v1 ships today"

    refreshed_notification = db_session.get(Notification, notification.id)
    assert refreshed_notification is not None
    assert refreshed_notification.recipient.username == "member"
    assert refreshed_notification.actor is not None
    assert refreshed_notification.actor.username == "owner"


def test_direct_chat_permissions_are_limited_to_access_and_send(db_session) -> None:
    first_user = make_user("first@example.com", "first")
    second_user = make_user("second@example.com", "second")
    db_session.add_all([first_user, second_user])
    db_session.flush()

    conversation = Conversation(kind="direct", created_by_id=first_user.id)
    member = ConversationMember(conversation=conversation, user=first_user, role="member")

    assert can_view_conversation(member) is True
    assert can_send_messages(conversation, member) is True
    assert can_manage_members(conversation, member) is False
    assert can_manage_topics(conversation, member) is False


def test_supergroup_permissions_follow_role_precedence(db_session) -> None:
    owner = make_user("owner2@example.com", "owner2")
    admin = make_user("admin@example.com", "admin")
    member_user = make_user("member2@example.com", "member2")
    db_session.add_all([owner, admin, member_user])
    db_session.flush()

    conversation = Conversation(kind="supergroup", created_by_id=owner.id)
    db_session.add(conversation)
    db_session.flush()

    owner_membership = ConversationMember(conversation_id=conversation.id, user_id=owner.id, role="owner")
    admin_membership = ConversationMember(conversation_id=conversation.id, user_id=admin.id, role="admin")
    member_membership = ConversationMember(
        conversation_id=conversation.id,
        user_id=member_user.id,
        role="member",
    )

    assert can_manage_members(conversation, owner_membership) is True
    assert can_manage_topics(conversation, owner_membership) is True
    assert can_manage_members(conversation, admin_membership) is True
    assert can_manage_topics(conversation, admin_membership) is True
    assert can_manage_members(conversation, member_membership) is False
    assert can_manage_topics(conversation, member_membership) is False

    assert can_remove_member(conversation, owner_membership, admin_membership) is True
    assert can_remove_member(conversation, admin_membership, member_membership) is True
    assert can_remove_member(conversation, admin_membership, owner_membership) is False
    assert can_remove_member(conversation, member_membership, admin_membership) is False


def test_left_members_lose_access_and_management_rights(db_session) -> None:
    user = make_user("left@example.com", "left")
    db_session.add(user)
    db_session.flush()

    conversation = Conversation(kind="group", created_by_id=user.id)
    member = ConversationMember(
        conversation=conversation,
        user=user,
        role="admin",
        left_at=datetime.now(UTC),
    )

    assert can_view_conversation(member) is False
    assert can_send_messages(conversation, member) is False
    assert can_manage_members(conversation, member) is False
    assert can_manage_topics(conversation, member) is False


def test_call_sessions_link_caller_and_callee(db_session) -> None:
    caller = make_user("caller@example.com", "caller")
    callee = make_user("callee@example.com", "callee")
    db_session.add_all([caller, callee])
    db_session.flush()

    conversation = Conversation(kind="direct", created_by_id=caller.id)
    db_session.add(conversation)
    db_session.flush()
    db_session.add_all(
        [
            ConversationMember(conversation_id=conversation.id, user_id=caller.id, role="owner"),
            ConversationMember(conversation_id=conversation.id, user_id=callee.id, role="member"),
        ]
    )
    db_session.flush()

    call = CallSession(
        conversation_id=conversation.id,
        caller_id=caller.id,
        callee_id=callee.id,
        kind="video",
        status="ringing",
        details={"transport": "webrtc-signaling-only"},
    )
    db_session.add(call)
    db_session.commit()

    persisted = db_session.get(CallSession, call.id)
    assert persisted is not None
    assert persisted.caller.username == "caller"
    assert persisted.callee.username == "callee"
    assert persisted.conversation.kind == "direct"
