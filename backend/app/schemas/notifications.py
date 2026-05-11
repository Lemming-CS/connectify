from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class NotificationActorRead(BaseModel):
    id: int
    username: str
    avatar_url: str | None

    model_config = ConfigDict(from_attributes=True)


class NotificationRead(BaseModel):
    id: int
    kind: str
    recipient_id: int
    conversation_id: int | None
    message_id: int | None
    actor: NotificationActorRead | None
    data: dict[str, Any]
    is_read: bool
    read_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NotificationReadResult(BaseModel):
    notification: NotificationRead


class NotificationClearResult(BaseModel):
    cleared_count: int
