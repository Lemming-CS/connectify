from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class UserRead(BaseModel):
    id: int
    email: str
    username: str
    avatar_url: str | None
    description: str | None
    status: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserProfileUpdate(BaseModel):
    avatar_url: HttpUrl | None = None
    description: str | None = Field(default=None, max_length=500)
    status: str | None = Field(
        default=None,
        pattern=r"^(online|offline|away|busy)$",
    )

