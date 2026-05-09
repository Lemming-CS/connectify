from fastapi import APIRouter

from app.api import auth, chats, realtime, users

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(chats.router)
api_router.include_router(realtime.router)
api_router.include_router(users.router)
