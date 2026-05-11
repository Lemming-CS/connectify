import httpx

from app.tests.helpers import auth_headers



async def test_register_user_hashes_password_and_returns_profile(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "sam@example.com",
            "username": "sam_01",
            "password": "secure-pass-123",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "sam@example.com"
    assert body["username"] == "sam_01"
    assert body["status"] == "offline"
    assert "hashed_password" not in body


async def test_register_rejects_duplicate_email(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": registered_user["email"],
            "username": "different",
            "password": "secure-pass-123",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Email is already registered"


async def test_register_normalizes_email_case_and_whitespace(
    client: httpx.AsyncClient,
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "  SAM@example.COM  ",
            "username": "  sam_02  ",
            "password": "secure-pass-123",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "sam@example.com"
    assert body["username"] == "sam_02"

    duplicate = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "sam@example.com",
            "username": "another_user",
            "password": "secure-pass-123",
        },
    )
    assert duplicate.status_code == 409


async def test_register_rejects_duplicate_username(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "different@example.com",
            "username": registered_user["username"],
            "password": "secure-pass-123",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Username is already taken"


async def test_login_returns_bearer_token(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"]
    assert body["token_type"] == "bearer"


async def test_login_accepts_trimmed_email(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": f"  {registered_user['email'].upper()}  ",
            "password": registered_user["password"],
        },
    )

    assert response.status_code == 200
    assert response.json()["access_token"]


async def test_login_rejects_wrong_password(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": registered_user["email"], "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


async def test_me_requires_valid_bearer_token(client: httpx.AsyncClient) -> None:
    response = await client.get("/api/v1/users/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"


async def test_me_returns_current_user(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    headers = await auth_headers(
        client,
        registered_user["email"],
        registered_user["password"],
    )

    response = await client.get("/api/v1/users/me", headers=headers)

    assert response.status_code == 200
    assert response.json()["email"] == registered_user["email"]
