from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.schemas.auth import UserCreate
from app.schemas.user import UserProfileUpdate


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: int) -> User | None:
        return self.db.get(User, user_id)

    def get_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(User.email == email.lower()))

    def get_by_username(self, username: str) -> User | None:
        return self.db.scalar(select(User).where(User.username == username))

    def create(self, payload: UserCreate) -> User:
        user = User(
            email=payload.email.lower(),
            username=payload.username,
            hashed_password=hash_password(payload.password),
            status="offline",
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def update_profile(self, user: User, payload: UserProfileUpdate) -> User:
        updates = payload.model_dump(exclude_unset=True, mode="json")
        for field, value in updates.items():
            setattr(user, field, value)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user
