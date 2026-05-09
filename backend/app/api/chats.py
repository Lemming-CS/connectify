from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.messaging import (
    ChatRead,
    DirectChatCreate,
    MessageCreate,
    MessagePage,
    MessageRead,
    MessageUpdate,
    ReadReceiptRead,
    ReadStatusUpdate,
    TypingIndicatorUpdate,
)
from app.services.messaging import ChatService, MessageService
from app.services.realtime import ConnectionManager

router = APIRouter(prefix="/chats", tags=["chats"])


def get_connection_manager(request: Request) -> ConnectionManager:
    return request.app.state.connection_manager


@router.post("/direct", response_model=ChatRead)
async def create_direct_chat(
    payload: DirectChatCreate,
    response: Response,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ChatRead:
    chat, created = ChatService(db).create_direct_chat(current_user, payload.participant_id)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return chat


@router.get("", response_model=list[ChatRead])
async def list_chats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[ChatRead]:
    return ChatService(db).list_chats(current_user)


@router.get("/{chat_id}/messages", response_model=MessagePage)
async def list_messages(
    chat_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    before_id: int | None = Query(default=None, gt=0),
    limit: int = Query(default=50, ge=1, le=100),
) -> MessagePage:
    return MessageService(db).list_messages(
        conversation_id=chat_id,
        current_user=current_user,
        before_id=before_id,
        limit=limit,
    )


@router.post("/{chat_id}/messages", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def send_message(
    chat_id: int,
    payload: MessageCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> MessageRead:
    message, recipients, event = MessageService(db).send_message(
        conversation_id=chat_id,
        current_user=current_user,
        body=payload.body,
    )
    await manager.send_event(recipients, event)
    return message


@router.patch("/{chat_id}/messages/{message_id}", response_model=MessageRead)
async def edit_message(
    chat_id: int,
    message_id: int,
    payload: MessageUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> MessageRead:
    message, recipients, event = MessageService(db).edit_message(
        conversation_id=chat_id,
        message_id=message_id,
        current_user=current_user,
        body=payload.body,
    )
    await manager.send_event(recipients, event)
    return message


@router.delete("/{chat_id}/messages/{message_id}", response_model=MessageRead)
async def delete_message(
    chat_id: int,
    message_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> MessageRead:
    message, recipients, event = MessageService(db).delete_message(
        conversation_id=chat_id,
        message_id=message_id,
        current_user=current_user,
    )
    await manager.send_event(recipients, event)
    return message


@router.post("/{chat_id}/read", response_model=ReadReceiptRead)
async def mark_read(
    chat_id: int,
    payload: ReadStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> ReadReceiptRead:
    receipt, recipients, event = ChatService(db).mark_read(
        conversation_id=chat_id,
        current_user=current_user,
        message_id=payload.message_id,
    )
    await manager.send_event(recipients, event)
    return receipt


@router.post("/{chat_id}/typing", status_code=status.HTTP_202_ACCEPTED)
async def publish_typing(
    chat_id: int,
    payload: TypingIndicatorUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    manager: ConnectionManager = Depends(get_connection_manager),
) -> dict[str, bool]:
    recipients, event = ChatService(db).publish_typing(
        conversation_id=chat_id,
        current_user=current_user,
        is_typing=payload.is_typing,
    )
    await manager.send_event(recipients, event)
    return {"accepted": True}
