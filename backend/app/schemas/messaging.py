from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ChatMemberRead(BaseModel):
    id: int
    username: str
    avatar_url: str | None
    status: str
    role: str

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


class AttachmentRead(BaseModel):
    id: int
    kind: str
    is_voice_message: bool
    original_filename: str | None
    content_type: str | None
    size_bytes: int
    checksum_sha256: str | None
    width: int | None
    height: int | None
    duration_seconds: int | None
    created_at: datetime
    media_url: str


class MessageRead(BaseModel):
    id: int
    conversation_id: int
    topic_id: int | None
    sender: MessageSenderRead
    body: str | None
    attachments: list[AttachmentRead] = Field(default_factory=list)
    created_at: datetime
    edited_at: datetime | None
    deleted_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ChatRead(BaseModel):
    id: int
    kind: str
    title: str | None
    description: str | None
    avatar_url: str | None
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime | None
    members: list[ChatMemberRead]
    read_states: list[ReadReceiptRead]


class DirectChatCreate(BaseModel):
    participant_id: int = Field(gt=0)


class GroupCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    avatar_url: str | None = Field(default=None, max_length=500)
    member_ids: list[int] = Field(default_factory=list)

    @field_validator("title", "description", "avatar_url", mode="before")
    @classmethod
    def strip_optional_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class MemberAdd(BaseModel):
    user_id: int = Field(gt=0)


class MemberRoleUpdate(BaseModel):
    role: str = Field(pattern=r"^(member|admin)$")


class TopicCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)

    @field_validator("title", "description", mode="before")
    @classmethod
    def strip_topic_text(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class TopicRead(BaseModel):
    id: int
    conversation_id: int
    title: str
    description: str | None
    is_general: bool
    is_closed: bool
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


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


class AttachmentUploadResult(BaseModel):
    message: MessageRead


class RealtimeEvent(BaseModel):
    type: str
    conversation_id: int
    payload: dict[str, Any]
