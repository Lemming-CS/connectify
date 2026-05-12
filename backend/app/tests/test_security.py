from datetime import timedelta

import httpx
from jose import jwt

from app.core.config import Settings, get_settings
from app.core.security import ALGORITHM, create_access_token, hash_password, verify_password, needs_password_rehash
from app.tests.helpers import auth_headers


def test_default_secret_is_rejected_outside_test_environment(
    monkeypatch,
) -> None:
    monkeypatch.setenv("CONNECTIFY_ENVIRONMENT", "development")
    monkeypatch.setenv("CONNECTIFY_SECRET_KEY", "change-me-in-production")
    get_settings.cache_clear()

    try:
        Settings()
    except ValueError as exc:
        assert "CONNECTIFY_SECRET_KEY must be set" in str(exc)
    else:
        raise AssertionError("default secret should be rejected outside tests")


def test_placeholder_secret_is_rejected_outside_test_environment(
    monkeypatch,
) -> None:
    monkeypatch.setenv("CONNECTIFY_ENVIRONMENT", "development")
    monkeypatch.setenv("CONNECTIFY_SECRET_KEY", "replace-with-a-long-random-secret")
    get_settings.cache_clear()

    try:
        Settings(_env_file=None)
    except ValueError as exc:
        assert "CONNECTIFY_SECRET_KEY must be set" in str(exc)
    else:
        raise AssertionError("placeholder secret should be rejected outside tests")


def test_password_hash_round_trip_and_wrong_password_rejection() -> None:
    password_hash = hash_password("secure-pass-123")

    assert verify_password("secure-pass-123", password_hash)
    assert not verify_password("wrong-pass", password_hash)


def test_password_verification_rejects_malformed_hashes() -> None:
    assert not verify_password("password", "not-a-supported-hash")
    assert not verify_password("password", "")
    assert not verify_password("password", "$argon2id$broken")

async def test_expired_token_is_rejected(
    client: httpx.AsyncClient,
    registered_user: dict[str, str],
) -> None:
    headers = await auth_headers(
        client,
        registered_user["email"],
        registered_user["password"],
    )
    current_user = await client.get("/api/v1/users/me", headers=headers)
    expired_token = create_access_token(
        str(current_user.json()["id"]),
        expires_delta=timedelta(seconds=-1),
    )

    response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"


async def test_tampered_token_is_rejected(client: httpx.AsyncClient) -> None:
    response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": "Bearer not-a-valid-token"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"


async def test_token_with_unapproved_algorithm_is_rejected(
    client: httpx.AsyncClient,
) -> None:
    settings = get_settings()
    token = jwt.encode({"sub": "1"}, settings.secret_key, algorithm="HS512")

    response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"


async def test_token_with_non_string_subject_is_rejected(
    client: httpx.AsyncClient,
) -> None:
    settings = get_settings()
    token = jwt.encode({"sub": 1}, settings.secret_key, algorithm=ALGORITHM)

    response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Could not validate credentials"

def test_password_hashing_roundtrip():
    password = "super-secret-password"

    hashed = hash_password(password)

    assert hashed != password
    assert verify_password(password, hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_password_hashes_are_unique_for_same_password() -> None:
    password = "secure-pass-123"

    first = hash_password(password)
    second = hash_password(password)

    assert first != second


def test_password_hash_uses_argon2() -> None:
    password_hash = hash_password("secure-pass-123")

    assert password_hash.startswith("$argon2id$")

def test_invalid_hash_returns_false():
    assert verify_password("password", "invalid-hash") is False

def test_new_hash_does_not_need_rehash() -> None:
    password_hash = hash_password("secure-pass-123")

    assert needs_password_rehash(password_hash) is False