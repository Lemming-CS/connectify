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
    title: str,
    member_ids: list[int] | None = None,
) -> httpx.Response:
    return await client.post(
        "/api/v1/chats/group",
        headers=headers,
        json={
            "title": title,
            "member_ids": member_ids or [],
        },
    )


async def test_direct_call_state_transitions_and_history(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    alice = await register_user(client, email="call-alice@example.com", username="call_alice")
    bob = await register_user(client, email="call-bob@example.com", username="call_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(client, email=bob["email"], password=bob["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    deliveries: list[tuple[list[int], dict[str, object]]] = []

    async def capture_send_event(user_ids, event):  # type: ignore[no-untyped-def]
        deliveries.append((list(user_ids), event))

    app.state.connection_manager.send_event = capture_send_event

    created = await client.post(
        f"/api/v1/chats/{chat_id}/calls",
        headers=alice_headers,
        json={"kind": "video"},
    )
    assert created.status_code == 201
    call_id = created.json()["id"]
    assert created.json()["status"] == "ringing"
    assert created.json()["kind"] == "video"
    assert created.json()["callee"]["id"] == bob["id"]

    accepted = await client.post(
        f"/api/v1/calls/{call_id}/accept",
        headers=bob_headers,
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "active"
    assert accepted.json()["accepted_at"] is not None

    signal = await client.post(
        f"/api/v1/calls/{call_id}/signal",
        headers=alice_headers,
        json={"signal_type": "offer", "payload": {"sdp": "fake-offer"}},
    )
    assert signal.status_code == 202
    assert signal.json() == {"accepted": True}

    ended = await client.post(
        f"/api/v1/calls/{call_id}/end",
        headers=bob_headers,
    )
    assert ended.status_code == 200
    assert ended.json()["status"] == "ended"
    assert ended.json()["ended_by_id"] == bob["id"]
    assert ended.json()["ended_at"] is not None

    history = await client.get(f"/api/v1/chats/{chat_id}/calls", headers=alice_headers)
    assert history.status_code == 200
    assert [item["id"] for item in history.json()] == [call_id]
    assert history.json()[0]["status"] == "ended"

    fetched = await client.get(f"/api/v1/calls/{call_id}", headers=bob_headers)
    assert fetched.status_code == 200
    assert fetched.json()["id"] == call_id

    event_types = [event["type"] for _, event in deliveries]
    assert event_types == ["call.created", "call.updated", "call.signal", "call.updated"]
    assert sorted(deliveries[0][0]) == sorted([alice["id"], bob["id"]])
    assert deliveries[2][0] == [bob["id"]]
    assert deliveries[2][1]["payload"]["signal_type"] == "offer"


async def test_calls_require_direct_chat_membership(client: httpx.AsyncClient) -> None:
    owner = await register_user(client, email="call-owner@example.com", username="call_owner")
    member = await register_user(client, email="call-member@example.com", username="call_member")
    outsider = await register_user(client, email="call-outsider@example.com", username="call_outsider")
    owner_headers = await auth_header(client, email=owner["email"], password=owner["password"])
    outsider_headers = await auth_header(client, email=outsider["email"], password=outsider["password"])

    direct = await create_direct_chat(client, owner_headers, member["id"])
    group = await create_group_chat(client, owner_headers, title="No Group Calls", member_ids=[member["id"]])

    group_attempt = await client.post(
        f"/api/v1/chats/{group.json()['id']}/calls",
        headers=owner_headers,
        json={"kind": "audio"},
    )
    outsider_attempt = await client.post(
        f"/api/v1/chats/{direct.json()['id']}/calls",
        headers=outsider_headers,
        json={"kind": "audio"},
    )

    assert group_attempt.status_code == 409
    assert group_attempt.json()["detail"] == "Calls are only available in direct chats"
    assert outsider_attempt.status_code == 403
    assert outsider_attempt.json()["detail"] == "You do not have access to this chat"


async def test_only_callee_can_accept_or_reject_and_open_calls_are_deduplicated(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="reject-alice@example.com", username="reject_alice")
    bob = await register_user(client, email="reject-bob@example.com", username="reject_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(client, email=bob["email"], password=bob["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    created = await client.post(
        f"/api/v1/chats/{chat_id}/calls",
        headers=alice_headers,
        json={"kind": "audio"},
    )
    call_id = created.json()["id"]

    forbidden_accept = await client.post(f"/api/v1/calls/{call_id}/accept", headers=alice_headers)
    duplicate = await client.post(
        f"/api/v1/chats/{chat_id}/calls",
        headers=alice_headers,
        json={"kind": "video"},
    )
    rejected = await client.post(f"/api/v1/calls/{call_id}/reject", headers=bob_headers)

    assert forbidden_accept.status_code == 403
    assert forbidden_accept.json()["detail"] == "Only the callee can accept this call"
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Another call is already in progress for this chat"
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    restarted = await client.post(
        f"/api/v1/chats/{chat_id}/calls",
        headers=alice_headers,
        json={"kind": "video"},
    )
    canceled = await client.post(
        f"/api/v1/calls/{restarted.json()['id']}/end",
        headers=alice_headers,
    )

    assert restarted.status_code == 201
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "canceled"


async def test_call_signal_requires_participation_and_open_state(
    client: httpx.AsyncClient,
    app: FastAPI,
) -> None:
    alice = await register_user(client, email="signal-alice@example.com", username="signal_alice")
    bob = await register_user(client, email="signal-bob@example.com", username="signal_bob")
    mallory = await register_user(client, email="signal-mallory@example.com", username="signal_mallory")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(client, email=bob["email"], password=bob["password"])
    mallory_headers = await auth_header(client, email=mallory["email"], password=mallory["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])
    chat_id = chat.json()["id"]

    deliveries: list[tuple[list[int], dict[str, object]]] = []

    async def capture_send_event(user_ids, event):  # type: ignore[no-untyped-def]
        deliveries.append((list(user_ids), event))

    app.state.connection_manager.send_event = capture_send_event

    created = await client.post(
        f"/api/v1/chats/{chat_id}/calls",
        headers=alice_headers,
        json={"kind": "audio"},
    )
    call_id = created.json()["id"]

    forbidden_signal = await client.post(
        f"/api/v1/calls/{call_id}/signal",
        headers=mallory_headers,
        json={"signal_type": "offer", "payload": {"sdp": "fake"}},
    )
    assert forbidden_signal.status_code == 403
    assert forbidden_signal.json()["detail"] == "You do not have access to this chat"

    accepted = await client.post(f"/api/v1/calls/{call_id}/accept", headers=bob_headers)
    assert accepted.status_code == 200

    ended = await client.post(f"/api/v1/calls/{call_id}/end", headers=alice_headers)
    assert ended.status_code == 200

    closed_signal = await client.post(
        f"/api/v1/calls/{call_id}/signal",
        headers=alice_headers,
        json={"signal_type": "ice_candidate", "payload": {"candidate": "x"}},
    )
    assert closed_signal.status_code == 409
    assert closed_signal.json()["detail"] == "Signaling is only available while a call is open"

    signal_events = [event for _, event in deliveries if event["type"] == "call.signal"]
    assert signal_events == []
