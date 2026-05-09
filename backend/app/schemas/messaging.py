from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatMemberRead(BaseModel):
    id: int
    username: str
    avatar_url: str | None
    status: str

    model_config = ConfigDict(from_attributes=True)


class ReadReceiptRead(BaseModel):
    user_id: int
    username: str
    last_read_message_id: int | None
    last_read_at: datetime | None


class MessageSenderRead(BaseModel):
    id: int
    username: str
    avatar_url: str | None

    model_config = ConfigDict(from_attributes=True)


class MessageRead(BaseModel):
    id: int
    conversation_id: int
    sender: MessageSenderRead
    body: str | None
    created_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ChatRead(BaseModel):
    id: int
    kind: str
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None
    members: list[ChatMemberRead]
    read_states: list[ReadReceiptRead]


class DirectChatCreate(BaseModel):
    participant_id: int = Field(gt=0)


class MessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body", mode="before")
    @classmethod
    def strip_body(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class MessageUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)

    @field_validator("body", mode="before")
    @classmethod
    def strip_body(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class MessagePage(BaseModel):
    items: list[MessageRead]
    next_before_id: int | None


class ReadStatusUpdate(BaseModel):
    message_id: int | None = Field(default=None, gt=0)


class TypingIndicatorUpdate(BaseModel):
    is_typing: bool = True


class RealtimeEvent(BaseModel):
    type: str
    conversation_id: int
    payload: dict[str, Any]
