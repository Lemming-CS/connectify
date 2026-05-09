import json
import os
import socket
import threading
import time
from uuid import uuid4
from collections.abc import AsyncGenerator, Generator

import httpx
import pytest
import uvicorn
import websockets
from fastapi import FastAPI


async def register_user(
    client: httpx.AsyncClient,
    *,
    email: str,
    username: str,
    password: str = "secure-pass-123",
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "username": username,
            "password": password,
        },
    )
    assert response.status_code == 201
    body = response.json()
    body["password"] = password
    return body


async def auth_header(
    client: httpx.AsyncClient,
    *,
    email: str,
    password: str,
) -> dict[str, str]:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def websocket_token(
    client: httpx.AsyncClient,
    *,
    email: str,
    password: str,
) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


async def create_direct_chat(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    participant_id: int,
) -> httpx.Response:
    return await client.post(
        "/api/v1/chats/direct",
        headers=headers,
        json={"participant_id": participant_id},
    )


async def create_group_chat(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    *,
    kind: str,
    title: str,
    member_ids: list[int] | None = None,
    description: str | None = None,
) -> httpx.Response:
    return await client.post(
        f"/api/v1/chats/{kind}",
        headers=headers,
        json={
            "title": title,
            "description": description,
            "member_ids": member_ids or [],
        },
    )


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def unique_identity(prefix: str) -> tuple[str, str]:
    suffix = uuid4().hex[:8]
    return f"{prefix}_{suffix}", f"{prefix}_{suffix}@example.com"


@pytest.fixture()
def live_server(app: FastAPI) -> Generator[str, None, None]:
    live_base_url = os.environ.get("CONNECTIFY_LIVE_BASE_URL")
    if live_base_url:
        yield live_base_url.rstrip("/")
        return

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    base_url = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            response = httpx.get(f"{base_url}/health", timeout=0.2)
            if response.status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    else:
        server.should_exit = True
        thread.join(timeout=5)
        raise RuntimeError("uvicorn test server did not start")

    yield base_url

    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture()
async def live_client(live_server: str) -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient(base_url=live_server) as client:
        yield client


async def test_create_direct_chat_is_deduplicated(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="alice@example.com", username="alice")
    bob = await register_user(client, email="bob@example.com", username="bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])

    first = await create_direct_chat(client, alice_headers, bob["id"])
    second = await create_direct_chat(client, alice_headers, bob["id"])

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert {member["username"] for member in first.json()["members"]} == {"alice", "bob"}


async def test_send_message_and_paginate(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="alice2@example.com", username="alice2")
    bob = await register_user(client, email="bob2@example.com", username="bob2")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    first_message = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "first"},
    )
    second_message = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "second"},
    )
    third_message = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "third"},
    )

    assert first_message.status_code == 201
    assert second_message.status_code == 201
    assert third_message.status_code == 201
    assert third_message.json()["created_at"]
    assert third_message.json()["sender"]["username"] == "alice2"

    page_one = await client.get(
        f"/api/v1/chats/{chat_id}/messages?limit=2",
        headers=alice_headers,
    )
    assert page_one.status_code == 200
    page_one_body = page_one.json()
    assert [item["body"] for item in page_one_body["items"]] == ["second", "third"]
    assert page_one_body["next_before_id"] == page_one_body["items"][0]["id"]

    page_two = await client.get(
        f"/api/v1/chats/{chat_id}/messages?limit=2&before_id={page_one_body['next_before_id']}",
        headers=alice_headers,
    )
    assert page_two.status_code == 200
    assert [item["body"] for item in page_two.json()["items"]] == ["first"]
    assert page_two.json()["next_before_id"] is None


async def test_message_created_event_is_delivered_in_realtime(
    live_client: httpx.AsyncClient,
    live_server: str,
) -> None:
    alice_username, alice_email = unique_identity("alice_rt")
    bob_username, bob_email = unique_identity("bob_rt")
    alice = await register_user(live_client, email=alice_email, username=alice_username)
    bob = await register_user(live_client, email=bob_email, username=bob_username)
    alice_headers = await auth_header(live_client, email=alice["email"], password=alice["password"])
    bob_token = await websocket_token(live_client, email=bob["email"], password=bob["password"])
    chat = await create_direct_chat(live_client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    websocket_url = f"{live_server.replace('http://', 'ws://')}/api/v1/realtime/ws?token={bob_token}"
    async with websockets.connect(websocket_url) as websocket:
        response = await live_client.post(
            f"/api/v1/chats/{chat_id}/messages",
            headers=alice_headers,
            json={"body": "hello in realtime"},
        )

        assert response.status_code == 201
        event = json.loads(await websocket.recv())
        assert event["type"] == "message.created"
        assert event["conversation_id"] == chat_id
        assert event["payload"]["body"] == "hello in realtime"
        assert event["payload"]["sender"]["username"] == alice_username


async def test_non_members_cannot_access_chat_messages(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="alice4@example.com", username="alice4")
    bob = await register_user(client, email="bob4@example.com", username="bob4")
    mallory = await register_user(client, email="mallory@example.com", username="mallory")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    mallory_headers = await auth_header(client, email=mallory["email"], password=mallory["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])

    response = await client.get(
        f"/api/v1/chats/{chat.json()['id']}/messages",
        headers=mallory_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have access to this chat"


async def test_only_permitted_users_can_edit_or_delete_messages(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="alice5@example.com", username="alice5")
    bob = await register_user(client, email="bob5@example.com", username="bob5")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(client, email=bob["email"], password=bob["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    created = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "original"},
    )
    assert created.status_code == 201
    message_id = created.json()["id"]

    forbidden_edit = await client.patch(
        f"/api/v1/chats/{chat_id}/messages/{message_id}",
        headers=bob_headers,
        json={"body": "tampered"},
    )
    forbidden_delete = await client.delete(
        f"/api/v1/chats/{chat_id}/messages/{message_id}",
        headers=bob_headers,
    )
    allowed_edit = await client.patch(
        f"/api/v1/chats/{chat_id}/messages/{message_id}",
        headers=alice_headers,
        json={"body": "edited"},
    )
    allowed_delete = await client.delete(
        f"/api/v1/chats/{chat_id}/messages/{message_id}",
        headers=alice_headers,
    )

    assert forbidden_edit.status_code == 403
    assert forbidden_delete.status_code == 403
    assert allowed_edit.status_code == 200
    assert allowed_edit.json()["body"] == "edited"
    assert allowed_edit.json()["edited_at"] is not None
    assert allowed_delete.status_code == 200
    assert allowed_delete.json()["body"] is None
    assert allowed_delete.json()["deleted_at"] is not None


async def test_mark_read_updates_receipt_and_emits_event(
    live_client: httpx.AsyncClient,
    live_server: str,
) -> None:
    alice_username, alice_email = unique_identity("alice_read")
    bob_username, bob_email = unique_identity("bob_read")
    alice = await register_user(live_client, email=alice_email, username=alice_username)
    bob = await register_user(live_client, email=bob_email, username=bob_username)
    alice_headers = await auth_header(live_client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(live_client, email=bob["email"], password=bob["password"])
    alice_token = await websocket_token(live_client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(live_client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    sent = await live_client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "please read"},
    )
    assert sent.status_code == 201
    message_id = sent.json()["id"]

    websocket_url = f"{live_server.replace('http://', 'ws://')}/api/v1/realtime/ws?token={alice_token}"
    async with websockets.connect(websocket_url) as websocket:
        receipt = await live_client.post(
            f"/api/v1/chats/{chat_id}/read",
            headers=bob_headers,
            json={"message_id": message_id},
        )

        assert receipt.status_code == 200
        assert receipt.json()["user_id"] == bob["id"]
        assert receipt.json()["last_read_message_id"] == message_id
        assert receipt.json()["last_read_at"] is not None

        event = json.loads(await websocket.recv())
        assert event["type"] == "message.read"
        assert event["conversation_id"] == chat_id
        assert event["payload"]["user_id"] == bob["id"]
        assert event["payload"]["last_read_message_id"] == message_id


async def test_create_group_and_supergroup(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="owner@example.com", username="owner")
    member = await register_user(client, email="member@example.com", username="member")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])

    group = await create_group_chat(
        client,
        owner_headers,
        kind="group",
        title="Builders",
        member_ids=[member["id"]],
        description="Internal working group",
    )
    supergroup = await create_group_chat(
        client,
        owner_headers,
        kind="supergroup",
        title="Announcements",
        member_ids=[member["id"]],
    )

    assert group.status_code == 201
    assert group.json()["kind"] == "group"
    assert group.json()["title"] == "Builders"
    assert {item["role"] for item in group.json()["members"]} == {"owner", "member"}

    assert supergroup.status_code == 201
    assert supergroup.json()["kind"] == "supergroup"
    topics = await client.get(
        f"/api/v1/chats/{supergroup.json()['id']}/topics",
        headers=owner_headers,
    )
    assert topics.status_code == 200
    assert topics.json()[0]["title"] == "General"
    assert topics.json()[0]["is_general"] is True


async def test_only_admins_or_owners_can_add_and_remove_members(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="owner2@example.com", username="owner2")
    admin = await register_user(client, email="admin@example.com", username="admin")
    member = await register_user(client, email="member2@example.com", username="member2")
    extra = await register_user(client, email="extra@example.com", username="extra")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    admin_headers = await auth_header(client, email=admin["email"], password=admin["password"])
    member_headers = await auth_header(client, email=member["email"], password=member["password"])

    group = await create_group_chat(
        client,
        owner_headers,
        kind="group",
        title="Ops",
        member_ids=[admin["id"], member["id"]],
    )
    chat_id = group.json()["id"]

    promoted = await client.patch(
        f"/api/v1/chats/{chat_id}/members/{admin['id']}",
        headers=owner_headers,
        json={"role": "admin"},
    )
    assert promoted.status_code == 200

    forbidden_add = await client.post(
        f"/api/v1/chats/{chat_id}/members",
        headers=member_headers,
        json={"user_id": extra["id"]},
    )
    allowed_add = await client.post(
        f"/api/v1/chats/{chat_id}/members",
        headers=admin_headers,
        json={"user_id": extra["id"]},
    )
    allowed_remove = await client.delete(
        f"/api/v1/chats/{chat_id}/members/{extra['id']}",
        headers=admin_headers,
    )

    assert forbidden_add.status_code == 403
    assert forbidden_add.json()["detail"] == "You cannot add members to this chat"
    assert allowed_add.status_code == 200
    assert {item["username"] for item in allowed_add.json()["members"]} == {"owner2", "admin", "member2", "extra"}
    assert allowed_remove.status_code == 200
    assert {item["username"] for item in allowed_remove.json()["members"]} == {"owner2", "admin", "member2"}


async def test_only_owner_can_promote_or_demote_admins(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="owner3@example.com", username="owner3")
    alice = await register_user(client, email="alice7@example.com", username="alice7")
    bob = await register_user(client, email="bob7@example.com", username="bob7")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])

    group = await create_group_chat(
        client,
        owner_headers,
        kind="group",
        title="Moderators",
        member_ids=[alice["id"], bob["id"]],
    )
    chat_id = group.json()["id"]

    forbidden = await client.patch(
        f"/api/v1/chats/{chat_id}/members/{bob['id']}",
        headers=alice_headers,
        json={"role": "admin"},
    )
    allowed = await client.patch(
        f"/api/v1/chats/{chat_id}/members/{alice['id']}",
        headers=owner_headers,
        json={"role": "admin"},
    )
    demoted = await client.patch(
        f"/api/v1/chats/{chat_id}/members/{alice['id']}",
        headers=owner_headers,
        json={"role": "member"},
    )

    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "Only the owner can change member roles"
    assert allowed.status_code == 200
    assert next(item for item in allowed.json()["members"] if item["username"] == "alice7")["role"] == "admin"
    assert demoted.status_code == 200
    assert next(item for item in demoted.json()["members"] if item["username"] == "alice7")["role"] == "member"


async def test_supergroup_topics_are_isolated_and_require_topic_endpoints(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="owner4@example.com", username="owner4")
    member = await register_user(client, email="member4@example.com", username="member4")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    member_headers = await auth_header(client, email=member["email"], password=member["password"])

    supergroup = await create_group_chat(
        client,
        owner_headers,
        kind="supergroup",
        title="Roadmap",
        member_ids=[member["id"]],
    )
    chat_id = supergroup.json()["id"]
    topics = await client.get(f"/api/v1/chats/{chat_id}/topics", headers=member_headers)
    assert topics.status_code == 200
    general_topic = topics.json()[0]

    releases_topic = await client.post(
        f"/api/v1/chats/{chat_id}/topics",
        headers=owner_headers,
        json={"title": "Releases", "description": "Shipped work"},
    )
    assert releases_topic.status_code == 201
    releases_topic_id = releases_topic.json()["id"]

    general_message = await client.post(
        f"/api/v1/chats/{chat_id}/topics/{general_topic['id']}/messages",
        headers=member_headers,
        json={"body": "general thread"},
    )
    releases_message = await client.post(
        f"/api/v1/chats/{chat_id}/topics/{releases_topic_id}/messages",
        headers=member_headers,
        json={"body": "release thread"},
    )
    invalid_root = await client.get(
        f"/api/v1/chats/{chat_id}/messages",
        headers=member_headers,
    )
    general_page = await client.get(
        f"/api/v1/chats/{chat_id}/topics/{general_topic['id']}/messages",
        headers=member_headers,
    )
    releases_page = await client.get(
        f"/api/v1/chats/{chat_id}/topics/{releases_topic_id}/messages",
        headers=member_headers,
    )

    assert general_message.status_code == 201
    assert releases_message.status_code == 201
    assert invalid_root.status_code == 409
    assert invalid_root.json()["detail"] == "Use a topic endpoint for supergroup messages"
    assert [item["body"] for item in general_page.json()["items"]] == ["general thread"]
    assert [item["body"] for item in releases_page.json()["items"]] == ["release thread"]
    assert general_page.json()["items"][0]["topic_id"] == general_topic["id"]
    assert releases_page.json()["items"][0]["topic_id"] == releases_topic_id


async def test_non_members_cannot_access_topics_or_topic_messages(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="owner5@example.com", username="owner5")
    member = await register_user(client, email="member5@example.com", username="member5")
    outsider = await register_user(client, email="outsider@example.com", username="outsider")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    outsider_headers = await auth_header(client, email=outsider["email"], password=outsider["password"])

    supergroup = await create_group_chat(
        client,
        owner_headers,
        kind="supergroup",
        title="Private Board",
        member_ids=[member["id"]],
    )
    chat_id = supergroup.json()["id"]
    topics = await client.get(f"/api/v1/chats/{chat_id}/topics", headers=owner_headers)
    topic_id = topics.json()[0]["id"]

    topics_denied = await client.get(f"/api/v1/chats/{chat_id}/topics", headers=outsider_headers)
    topic_messages_denied = await client.get(
        f"/api/v1/chats/{chat_id}/topics/{topic_id}/messages",
        headers=outsider_headers,
    )

    assert topics_denied.status_code == 403
    assert topic_messages_denied.status_code == 403
    assert topics_denied.json()["detail"] == "You do not have access to this chat"
    assert topic_messages_denied.json()["detail"] == "You do not have access to this chat"


async def test_membership_edge_cases_are_enforced(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="owner6@example.com", username="owner6")
    admin = await register_user(client, email="admin6@example.com", username="admin6")
    member = await register_user(client, email="member6@example.com", username="member6")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    admin_headers = await auth_header(client, email=admin["email"], password=admin["password"])
    member_headers = await auth_header(client, email=member["email"], password=member["password"])

    group = await create_group_chat(
        client,
        owner_headers,
        kind="group",
        title="Edge Cases",
        member_ids=[admin["id"], member["id"]],
    )
    chat_id = group.json()["id"]

    promoted = await client.patch(
        f"/api/v1/chats/{chat_id}/members/{admin['id']}",
        headers=owner_headers,
        json={"role": "admin"},
    )
    assert promoted.status_code == 200

    duplicate_add = await client.post(
        f"/api/v1/chats/{chat_id}/members",
        headers=owner_headers,
        json={"user_id": member["id"]},
    )
    remove_owner = await client.delete(
        f"/api/v1/chats/{chat_id}/members/{owner['id']}",
        headers=owner_headers,
    )
    admin_remove_owner = await client.delete(
        f"/api/v1/chats/{chat_id}/members/{owner['id']}",
        headers=admin_headers,
    )
    removed_member = await client.delete(
        f"/api/v1/chats/{chat_id}/members/{member['id']}",
        headers=admin_headers,
    )
    removed_member_access = await client.get(
        f"/api/v1/chats/{chat_id}/messages",
        headers=member_headers,
    )
    restored_member = await client.post(
        f"/api/v1/chats/{chat_id}/members",
        headers=owner_headers,
        json={"user_id": member["id"]},
    )

    assert duplicate_add.status_code == 409
    assert duplicate_add.json()["detail"] == "User is already a member of this chat"
    assert remove_owner.status_code == 409
    assert remove_owner.json()["detail"] == "The owner cannot be removed from the chat"
    assert admin_remove_owner.status_code == 409
    assert removed_member.status_code == 200
    assert removed_member_access.status_code == 403
    assert restored_member.status_code == 200
    assert {item["username"] for item in restored_member.json()["members"]} == {"owner6", "admin6", "member6"}


async def test_only_admins_or_owners_can_manage_topics_and_archived_topics_block_sends(
    client: httpx.AsyncClient,
) -> None:
    owner = await register_user(client, email="owner7@example.com", username="owner7")
    member = await register_user(client, email="member7@example.com", username="member7")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    member_headers = await auth_header(client, email=member["email"], password=member["password"])

    supergroup = await create_group_chat(
        client,
        owner_headers,
        kind="supergroup",
        title="Product",
        member_ids=[member["id"]],
    )
    chat_id = supergroup.json()["id"]

    forbidden_topic = await client.post(
        f"/api/v1/chats/{chat_id}/topics",
        headers=member_headers,
        json={"title": "Private", "description": "should fail"},
    )
    topic = await client.post(
        f"/api/v1/chats/{chat_id}/topics",
        headers=owner_headers,
        json={"title": "Launch", "description": "launch thread"},
    )
    archived = await client.post(
        f"/api/v1/chats/{chat_id}/topics/{topic.json()['id']}/archive",
        headers=owner_headers,
    )
    blocked_send = await client.post(
        f"/api/v1/chats/{chat_id}/topics/{topic.json()['id']}/messages",
        headers=member_headers,
        json={"body": "too late"},
    )

    assert forbidden_topic.status_code == 403
    assert forbidden_topic.json()["detail"] == "You cannot create topics in this supergroup"
    assert topic.status_code == 201
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None
    assert archived.json()["is_closed"] is True
    assert blocked_send.status_code == 403
    assert blocked_send.json()["detail"] == "You cannot send messages in this topic"
