from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.auth import LoginRequest, Token, UserCreate
from app.schemas.user import UserRead
from app.services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: Session = Depends(get_db)) -> UserRead:
    return AuthService(db).register(payload)


@router.post("/login", response_model=Token)
async def login(payload: LoginRequest, db: Session = Depends(get_db)) -> Token:
    return AuthService(db).login(payload)
