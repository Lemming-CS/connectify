import json
import socket
import threading
import time
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


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture()
def live_server(app: FastAPI) -> Generator[str, None, None]:
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
    alice = await register_user(live_client, email="alice3@example.com", username="alice3")
    bob = await register_user(live_client, email="bob3@example.com", username="bob3")
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
        assert event["payload"]["sender"]["username"] == "alice3"


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
    alice = await register_user(live_client, email="alice6@example.com", username="alice6")
    bob = await register_user(live_client, email="bob6@example.com", username="bob6")
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
