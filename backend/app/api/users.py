from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.repositories.users import UserRepository
from app.schemas.user import UserProfileUpdate, UserRead

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserRead)
async def read_me(current_user: Annotated[User, Depends(get_current_user)]) -> UserRead:
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_me(
    payload: UserProfileUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> UserRead:
    return UserRepository(db).update_profile(current_user, payload)
