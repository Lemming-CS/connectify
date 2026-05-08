from datetime import timedelta

import httpx
from jose import jwt

from app.core.config import Settings, get_settings
from app.core.security import ALGORITHM, create_access_token, hash_password, verify_password
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
    assert not verify_password("password", "pbkdf2_sha256$9999999999$" + "00" * 16 + "$" + "00" * 32)
    assert not verify_password("password", "pbkdf2_sha256$210000$00$" + "00" * 32)


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
