import httpx

from app.tests.helpers import auth_headers


async def test_update_profile_allows_owner(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    headers = await auth_headers(
        client,
        registered_user["email"],
        registered_user["password"],
    )

    response = await client.patch(
        "/api/v1/users/me",
        headers=headers,
        json={
            "avatar_url": "https://example.com/avatar.png",
            "description": "Building a messenger.",
            "status": "online",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["avatar_url"] == "https://example.com/avatar.png"
    assert body["description"] == "Building a messenger."
    assert body["status"] == "online"


async def test_update_profile_rejects_invalid_status(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    headers = await auth_headers(
        client,
        registered_user["email"],
        registered_user["password"],
    )

    response = await client.patch(
        "/api/v1/users/me",
        headers=headers,
        json={"status": "invisible"},
    )

    assert response.status_code == 422


async def test_update_profile_requires_authentication(
    client: httpx.AsyncClient,
) -> None:
    response = await client.patch("/api/v1/users/me", json={"status": "online"})

    assert response.status_code == 401
