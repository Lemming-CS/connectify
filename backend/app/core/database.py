from collections.abc import AsyncGenerator
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.orm.session import sessionmaker as SessionmakerType

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or get_settings().database_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


@lru_cache
def get_engine() -> Engine:
    return build_engine()


@lru_cache
def get_sessionmaker() -> SessionmakerType[Session]:
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False)


async def get_db() -> AsyncGenerator[Session, None]:
    db = get_sessionmaker()()
    try:
        yield db
    finally:
        db.close()
