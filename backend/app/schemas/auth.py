from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email", "username", mode="before")
    @classmethod
    def strip_identity_fields(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip()
        return value


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
