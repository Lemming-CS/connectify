from uuid import uuid4

import httpx
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
) -> httpx.Response:
    return await client.post(
        f"/api/v1/chats/{kind}",
        headers=headers,
        json={
            "title": title,
            "member_ids": member_ids or [],
        },
    )


def unique_identity(prefix: str) -> tuple[str, str]:
    suffix = uuid4().hex[:8]
    return f"{prefix}_{suffix}", f"{prefix}_{suffix}@example.com"


async def test_message_notifications_are_created_for_the_correct_recipient(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="notify-alice@example.com", username="notify_alice")
    bob = await register_user(client, email="notify-bob@example.com", username="notify_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(client, email=bob["email"], password=bob["password"])

    chat = await create_direct_chat(client, alice_headers, bob["id"])
    assert chat.status_code == 201

    sent = await client.post(
        f"/api/v1/chats/{chat.json()['id']}/messages",
        headers=alice_headers,
        json={"body": "hello @notify_bob @notify_bob"},
    )
    assert sent.status_code == 201

    bob_notifications = await client.get("/api/v1/notifications", headers=bob_headers)
    alice_notifications = await client.get("/api/v1/notifications", headers=alice_headers)

    assert bob_notifications.status_code == 200
    assert alice_notifications.status_code == 200
    assert len(bob_notifications.json()) == 1
    assert alice_notifications.json() == []

    notification = bob_notifications.json()[0]
    assert notification["recipient_id"] == bob["id"]
    assert notification["actor"]["username"] == "notify_alice"
    assert notification["kind"] == "message_mention"
    assert notification["message_id"] == sent.json()["id"]
    assert notification["data"]["message_preview"] == "hello @notify_bob @notify_bob"


async def test_group_notifications_cover_invites_role_changes_and_removals(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="group-owner@example.com", username="group_owner")
    member = await register_user(client, email="group-member@example.com", username="group_member")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    member_headers = await auth_header(client, email=member["email"], password=member["password"])

    group = await create_group_chat(
        client,
        owner_headers,
        kind="group",
        title="Alerts",
        member_ids=[member["id"]],
    )
    assert group.status_code == 201
    chat_id = group.json()["id"]

    promoted = await client.patch(
        f"/api/v1/chats/{chat_id}/members/{member['id']}",
        headers=owner_headers,
        json={"role": "admin"},
    )
    removed = await client.delete(
        f"/api/v1/chats/{chat_id}/members/{member['id']}",
        headers=owner_headers,
    )

    assert promoted.status_code == 200
    assert removed.status_code == 200

    notifications = await client.get("/api/v1/notifications?unread_only=false", headers=member_headers)
    assert notifications.status_code == 200
    kinds = [item["kind"] for item in notifications.json()]
    assert kinds == ["group_member_removed", "group_role_changed", "group_invite"]


async def test_notifications_can_be_marked_read_cleared_and_are_user_scoped(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="scope-alice@example.com", username="scope_alice")
    bob = await register_user(client, email="scope-bob@example.com", username="scope_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(client, email=bob["email"], password=bob["password"])

    chat = await create_direct_chat(client, alice_headers, bob["id"])
    assert chat.status_code == 201
    chat_id = chat.json()["id"]

    first = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "first unread"},
    )
    second = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "second unread"},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    unread = await client.get("/api/v1/notifications", headers=bob_headers)
    assert unread.status_code == 200
    unread_ids = [item["id"] for item in unread.json()]
    assert len(unread_ids) == 2

    forbidden = await client.post(f"/api/v1/notifications/{unread_ids[0]}/read", headers=alice_headers)
    assert forbidden.status_code == 404

    marked = await client.post(f"/api/v1/notifications/{unread_ids[0]}/read", headers=bob_headers)
    assert marked.status_code == 200
    assert marked.json()["is_read"] is True
    assert marked.json()["read_at"] is not None

    still_unread = await client.get("/api/v1/notifications", headers=bob_headers)
    assert still_unread.status_code == 200
    assert [item["id"] for item in still_unread.json()] == [unread_ids[1]]

    mark_all = await client.post("/api/v1/notifications/read-all", headers=bob_headers)
    assert mark_all.status_code == 200
    assert len(mark_all.json()) == 1
    assert mark_all.json()[0]["id"] == unread_ids[1]
    assert mark_all.json()[0]["is_read"] is True

    all_notifications = await client.get("/api/v1/notifications?unread_only=false", headers=bob_headers)
    assert all_notifications.status_code == 200
    assert len(all_notifications.json()) == 2
    assert all(item["is_read"] for item in all_notifications.json())

    cleared = await client.delete("/api/v1/notifications", headers=bob_headers)
    assert cleared.status_code == 200
    assert cleared.json()["cleared_count"] == 2

    after_clear = await client.get("/api/v1/notifications?unread_only=false", headers=bob_headers)
    assert after_clear.status_code == 200
    assert after_clear.json() == []


async def test_notification_events_are_dispatched_to_realtime_manager(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    alice_username, alice_email = unique_identity("notif_alice")
    bob_username, bob_email = unique_identity("notif_bob")
    alice = await register_user(client, email=alice_email, username=alice_username)
    bob = await register_user(client, email=bob_email, username=bob_username)
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    deliveries: list[tuple[list[int], dict[str, object]]] = []

    async def capture_send_event(user_ids, event):  # type: ignore[no-untyped-def]
        deliveries.append((list(user_ids), event))

    app.state.connection_manager.send_event = capture_send_event

    response = await client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=alice_headers,
        json={"body": "hello realtime"},
    )

    assert response.status_code == 201
    assert len(deliveries) == 2

    message_delivery = next(item for item in deliveries if item[1]["type"] == "message.created")
    notification_delivery = next(item for item in deliveries if item[1]["type"] == "notification.created")

    assert sorted(message_delivery[0]) == sorted([alice["id"], bob["id"]])
    assert notification_delivery[0] == [bob["id"]]
    assert notification_delivery[1]["payload"]["recipient_id"] == bob["id"]
    assert notification_delivery[1]["payload"]["actor"]["username"] == alice_username
    assert notification_delivery[1]["payload"]["kind"] == "message_new"
