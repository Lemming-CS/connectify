from collections.abc import AsyncGenerator, Generator

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.main import create_app
from app.models import User  # noqa: F401

TEST_DATABASE_URL = "sqlite://"


@pytest.fixture(autouse=True)
def test_settings(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    monkeypatch.setenv("CONNECTIFY_ENVIRONMENT", "test")
    monkeypatch.setenv("CONNECTIFY_DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("CONNECTIFY_SECRET_KEY", "test-secret-key-for-connectify")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def test_media_root(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> Generator[None, None, None]:
    monkeypatch.setenv("CONNECTIFY_MEDIA_ROOT", str(tmp_path / "media"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def db_engine() -> Generator:
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db_sessionmaker(db_engine) -> sessionmaker:
    return sessionmaker(bind=db_engine, autoflush=False, autocommit=False)


@pytest.fixture()
def db_session(db_sessionmaker: sessionmaker) -> Generator[Session, None, None]:
    with db_sessionmaker() as session:
        yield session


@pytest.fixture()
def app(db_sessionmaker: sessionmaker) -> Generator[FastAPI, None, None]:
    app = create_app()

    async def override_get_db() -> AsyncGenerator[Session, None]:
        with db_sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.state.sessionmaker = db_sessionmaker
    yield app
    app.dependency_overrides.clear()


@pytest.fixture()
async def client(app: FastAPI) -> AsyncGenerator[httpx.AsyncClient, None]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as test_client:
        yield test_client


@pytest.fixture()
async def registered_user(client: httpx.AsyncClient) -> dict[str, str]:
    payload = {
        "email": "alex@example.com",
        "username": "alex",
        "password": "secure-pass-123",
    }
    response = await client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 201
    return payload
