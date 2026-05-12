from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class CallUserRead(BaseModel):
    id: int
    username: str
    avatar_url: str | None

    model_config = ConfigDict(from_attributes=True)


class CallRead(BaseModel):
    id: int
    conversation_id: int
    caller: CallUserRead
    callee: CallUserRead
    ended_by_id: int | None
    kind: str
    status: str
    metadata: dict[str, Any]
    created_at: datetime
    accepted_at: datetime | None
    ended_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class CallCreate(BaseModel):
    kind: str = Field(pattern=r"^(audio|video)$")


class CallSignalCreate(BaseModel):
    signal_type: str = Field(pattern=r"^(offer|answer|ice_candidate)$")
    payload: dict[str, Any] = Field(default_factory=dict)


class CallSignalAccepted(BaseModel):
    accepted: bool
