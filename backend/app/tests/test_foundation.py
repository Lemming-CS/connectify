import httpx

from app.core.config import get_settings
from app.core.database import build_engine
from app.main import create_app


async def test_health_check_does_not_require_database_connection(
    monkeypatch,
) -> None:
    monkeypatch.setenv(
        "CONNECTIFY_DATABASE_URL",
        "postgresql+psycopg2://invalid:invalid@127.0.0.1:1/invalid",
    )
    get_settings.cache_clear()

    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_default_database_url_is_postgresql(monkeypatch) -> None:
    monkeypatch.delenv("CONNECTIFY_DATABASE_URL", raising=False)
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.database_url.startswith("postgresql+psycopg2://")


def test_sqlite_engine_is_available_for_tests_only() -> None:
    engine = build_engine("sqlite://")

    assert engine.url.drivername == "sqlite"
