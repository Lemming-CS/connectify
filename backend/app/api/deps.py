from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User
from app.repositories.users import UserRepository

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def get_user_from_token(token: str | None, db: Session) -> User | None:
    try:
        if token is None:
            return None
        payload = decode_access_token(token)
        subject = payload.get("sub")
        if not isinstance(subject, str):
            return None
        user_id = int(subject)
    except (JWTError, ValueError):
        return None

    user = UserRepository(db).get_by_id(user_id)
    if user is None or not user.is_active:
        return None
    return user


async def get_current_user(
    token: Annotated[str | None, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = get_user_from_token(token, db)
    if user is None:
        raise credentials_error
    return user
