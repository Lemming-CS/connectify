import os
import socket
import threading
import time
from uuid import uuid4

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from app.core.config import get_settings


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
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


async def create_direct_chat(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    participant_id: int,
) -> dict[str, object]:
    response = await client.post(
        "/api/v1/chats/direct",
        headers=headers,
        json={"participant_id": participant_id},
    )
    assert response.status_code in {200, 201}
    return response.json()


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def unique_identity(prefix: str) -> tuple[str, str]:
    suffix = uuid4().hex[:8]
    return f"{prefix}_{suffix}", f"{prefix}_{suffix}@example.com"


@pytest.fixture()
def live_server(app: FastAPI):
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
async def live_client(live_server: str):
    async with httpx.AsyncClient(base_url=live_server) as client:
        yield client


async def test_valid_upload_creates_message_and_streamable_media(live_client: httpx.AsyncClient) -> None:
    alice_username, alice_email = unique_identity("attach_alice")
    bob_username, bob_email = unique_identity("attach_bob")
    alice = await register_user(live_client, email=alice_email, username=alice_username)
    bob = await register_user(live_client, email=bob_email, username=bob_username)
    alice_headers = await auth_header(live_client, email=alice["email"], password=alice["password"])
    bob_headers = await auth_header(live_client, email=bob["email"], password=bob["password"])
    chat = await create_direct_chat(live_client, alice_headers, bob["id"])

    response = await live_client.post(
        f"/api/v1/chats/{chat['id']}/attachments",
        headers=alice_headers,
        data={"body": "photo"},
        files={"file": ("photo.png", b"fake-png-data", "image/png")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["body"] == "photo"
    assert body["attachments"][0]["kind"] == "image"
    assert body["attachments"][0]["content_type"] == "image/png"
    assert body["attachments"][0]["size_bytes"] == len(b"fake-png-data")

    media = await live_client.get(body["attachments"][0]["media_url"], headers=bob_headers)
    assert media.status_code == 200
    assert media.headers["content-type"] == "image/png"
    assert "inline" in media.headers["content-disposition"]
    assert media.content == b"fake-png-data"


async def test_invalid_mime_type_is_rejected(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="mime-alice@example.com", username="mime_alice")
    bob = await register_user(client, email="mime-bob@example.com", username="mime_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])

    response = await client.post(
        f"/api/v1/chats/{chat['id']}/attachments",
        headers=alice_headers,
        files={"file": ("danger.exe", b"MZ", "application/x-msdownload")},
    )

    assert response.status_code == 415
    assert response.json()["detail"] == "Unsupported media type"


async def test_oversized_upload_is_rejected(client: httpx.AsyncClient, monkeypatch) -> None:
    monkeypatch.setenv("CONNECTIFY_MEDIA_MAX_IMAGE_UPLOAD_BYTES", "1024")
    get_settings.cache_clear()

    alice = await register_user(client, email="big-alice@example.com", username="big_alice")
    bob = await register_user(client, email="big-bob@example.com", username="big_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])

    response = await client.post(
        f"/api/v1/chats/{chat['id']}/attachments",
        headers=alice_headers,
        files={"file": ("huge.png", b"x" * 2048, "image/png")},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "Uploaded file is too large"


async def test_attachment_is_linked_to_message(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="link-alice@example.com", username="link_alice")
    bob = await register_user(client, email="link-bob@example.com", username="link_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])

    response = await client.post(
        f"/api/v1/chats/{chat['id']}/attachments",
        headers=alice_headers,
        files={"file": ("notes.txt", b"hello attachment", "text/plain")},
    )

    assert response.status_code == 201
    message_id = response.json()["id"]
    attachment_id = response.json()["attachments"][0]["id"]

    messages = await client.get(
        f"/api/v1/chats/{chat['id']}/messages",
        headers=alice_headers,
    )
    assert messages.status_code == 200
    assert messages.json()["items"][0]["id"] == message_id
    assert messages.json()["items"][0]["attachments"][0]["id"] == attachment_id


async def test_private_media_access_is_enforced(live_client: httpx.AsyncClient) -> None:
    alice_username, alice_email = unique_identity("private_alice")
    bob_username, bob_email = unique_identity("private_bob")
    outsider_username, outsider_email = unique_identity("private_out")
    alice = await register_user(live_client, email=alice_email, username=alice_username)
    bob = await register_user(live_client, email=bob_email, username=bob_username)
    outsider = await register_user(live_client, email=outsider_email, username=outsider_username)
    alice_headers = await auth_header(live_client, email=alice["email"], password=alice["password"])
    outsider_headers = await auth_header(live_client, email=outsider["email"], password=outsider["password"])
    chat = await create_direct_chat(live_client, alice_headers, bob["id"])

    response = await live_client.post(
        f"/api/v1/chats/{chat['id']}/attachments",
        headers=alice_headers,
        files={"file": ("report.pdf", b"%PDF-report", "application/pdf")},
    )
    media_url = response.json()["attachments"][0]["media_url"]

    denied = await live_client.get(media_url, headers=outsider_headers)
    allowed = await live_client.get(f"{media_url}?download=true", headers=alice_headers)

    assert denied.status_code == 403
    assert denied.json()["detail"] == "You do not have access to this media"
    assert allowed.status_code == 200
    assert allowed.headers["content-type"] == "application/pdf"
    assert "attachment" in allowed.headers["content-disposition"]


async def test_voice_message_upload_marks_audio_as_voice(client: httpx.AsyncClient) -> None:
    alice = await register_user(client, email="voice-alice@example.com", username="voice_alice")
    bob = await register_user(client, email="voice-bob@example.com", username="voice_bob")
    alice_headers = await auth_header(client, email=alice["email"], password=alice["password"])
    chat = await create_direct_chat(client, alice_headers, bob["id"])

    response = await client.post(
        f"/api/v1/chats/{chat['id']}/attachments",
        headers=alice_headers,
        data={"is_voice_message": "true"},
        files={"file": ("voice.ogg", b"OggSvoice-data", "audio/ogg")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["attachments"][0]["kind"] == "audio"
    assert body["attachments"][0]["is_voice_message"] is True
    assert body["attachments"][0]["content_type"] == "audio/ogg"
