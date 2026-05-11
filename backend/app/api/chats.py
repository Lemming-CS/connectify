from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.messaging import (
    ChatRead,
    DirectChatCreate,
    GroupCreate,
    MemberAdd,
    MemberRoleUpdate,
    MessageCreate,
    MessagePage,
    MessageRead,
    MessageUpdate,
    ReadReceiptRead,
    ReadStatusUpdate,
    TopicCreate,
    TopicRead,
    TypingIndicatorUpdate,
)
from app.services.messaging import ChatService, MessageService, TopicService
from app.services.notifications import RealtimeDelivery
from app.services.attachments import AttachmentService
from app.services.realtime import ConnectionManager

router = APIRouter(prefix="/chats", tags=["chats"])


async def _send_deliveries(manager: ConnectionManager, deliveries: list[RealtimeDelivery]) -> None:
    for delivery in deliveries:
        await manager.send_event(delivery.recipients, delivery.event)


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


@router.post("/group", response_model=ChatRead, status_code=status.HTTP_201_CREATED)
async def create_group(
    payload: GroupCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ChatRead:
    manager: ConnectionManager = request.app.state.connection_manager
    chat, deliveries = ChatService(db).create_group(current_user=current_user, payload=payload, kind="group")
    await _send_deliveries(manager, deliveries)
    return chat


@router.post("/supergroup", response_model=ChatRead, status_code=status.HTTP_201_CREATED)
async def create_supergroup(
    payload: GroupCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ChatRead:
    manager: ConnectionManager = request.app.state.connection_manager
    chat, deliveries = ChatService(db).create_group(current_user=current_user, payload=payload, kind="supergroup")
    await _send_deliveries(manager, deliveries)
    return chat


@router.get("", response_model=list[ChatRead])
async def list_chats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[ChatRead]:
    return ChatService(db).list_chats(current_user)


@router.post("/{chat_id}/members", response_model=ChatRead)
async def add_member(
    chat_id: int,
    payload: MemberAdd,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ChatRead:
    manager: ConnectionManager = request.app.state.connection_manager
    chat, deliveries = ChatService(db).add_member(
        conversation_id=chat_id,
        current_user=current_user,
        user_id=payload.user_id,
    )
    await _send_deliveries(manager, deliveries)
    return chat


@router.delete("/{chat_id}/members/{user_id}", response_model=ChatRead)
async def remove_member(
    chat_id: int,
    user_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ChatRead:
    manager: ConnectionManager = request.app.state.connection_manager
    chat, deliveries = ChatService(db).remove_member(
        conversation_id=chat_id,
        current_user=current_user,
        user_id=user_id,
    )
    await _send_deliveries(manager, deliveries)
    return chat


@router.patch("/{chat_id}/members/{user_id}", response_model=ChatRead)
async def update_member_role(
    chat_id: int,
    user_id: int,
    payload: MemberRoleUpdate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ChatRead:
    manager: ConnectionManager = request.app.state.connection_manager
    chat, deliveries = ChatService(db).update_member_role(
        conversation_id=chat_id,
        current_user=current_user,
        user_id=user_id,
        role=payload.role,
    )
    await _send_deliveries(manager, deliveries)
    return chat


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
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> MessageRead:
    manager: ConnectionManager = request.app.state.connection_manager
    message, deliveries = MessageService(db).send_message(
        conversation_id=chat_id,
        current_user=current_user,
        body=payload.body,
    )
    await _send_deliveries(manager, deliveries)
    return message


@router.post("/{chat_id}/attachments", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    chat_id: int,
    request: Request,
    *,
    file: UploadFile = File(...),
    body: str | None = Form(default=None),
    is_voice_message: bool = Form(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageRead:
    manager: ConnectionManager = request.app.state.connection_manager
    message, deliveries = await AttachmentService(db).upload_message_attachment(
        conversation_id=chat_id,
        current_user=current_user,
        upload=file,
        body=body.strip() if body is not None else None,
        is_voice_message=is_voice_message,
    )
    await _send_deliveries(manager, deliveries)
    return message


@router.get("/{chat_id}/topics", response_model=list[TopicRead])
async def list_topics(
    chat_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[TopicRead]:
    return TopicService(db).list_topics(conversation_id=chat_id, current_user=current_user)


@router.post("/{chat_id}/topics", response_model=TopicRead, status_code=status.HTTP_201_CREATED)
async def create_topic(
    chat_id: int,
    payload: TopicCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> TopicRead:
    return TopicService(db).create_topic(
        conversation_id=chat_id,
        current_user=current_user,
        title=payload.title,
        description=payload.description,
    )


@router.post("/{chat_id}/topics/{topic_id}/archive", response_model=TopicRead)
async def archive_topic(
    chat_id: int,
    topic_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> TopicRead:
    return TopicService(db).archive_topic(
        conversation_id=chat_id,
        topic_id=topic_id,
        current_user=current_user,
    )


@router.get("/{chat_id}/topics/{topic_id}/messages", response_model=MessagePage)
async def list_topic_messages(
    chat_id: int,
    topic_id: int,
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
        topic_id=topic_id,
    )


@router.post("/{chat_id}/topics/{topic_id}/messages", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def send_topic_message(
    chat_id: int,
    topic_id: int,
    payload: MessageCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> MessageRead:
    manager: ConnectionManager = request.app.state.connection_manager
    message, deliveries = MessageService(db).send_message(
        conversation_id=chat_id,
        current_user=current_user,
        body=payload.body,
        topic_id=topic_id,
    )
    await _send_deliveries(manager, deliveries)
    return message


@router.post("/{chat_id}/topics/{topic_id}/attachments", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
async def upload_topic_attachment(
    chat_id: int,
    topic_id: int,
    request: Request,
    *,
    file: UploadFile = File(...),
    body: str | None = Form(default=None),
    is_voice_message: bool = Form(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> MessageRead:
    manager: ConnectionManager = request.app.state.connection_manager
    message, deliveries = await AttachmentService(db).upload_message_attachment(
        conversation_id=chat_id,
        current_user=current_user,
        upload=file,
        body=body.strip() if body is not None else None,
        is_voice_message=is_voice_message,
        topic_id=topic_id,
    )
    await _send_deliveries(manager, deliveries)
    return message


@router.patch("/{chat_id}/messages/{message_id}", response_model=MessageRead)
async def edit_message(
    chat_id: int,
    message_id: int,
    payload: MessageUpdate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> MessageRead:
    manager: ConnectionManager = request.app.state.connection_manager
    message, deliveries = MessageService(db).edit_message(
        conversation_id=chat_id,
        message_id=message_id,
        current_user=current_user,
        body=payload.body,
    )
    await _send_deliveries(manager, deliveries)
    return message


@router.delete("/{chat_id}/messages/{message_id}", response_model=MessageRead)
async def delete_message(
    chat_id: int,
    message_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> MessageRead:
    manager: ConnectionManager = request.app.state.connection_manager
    message, deliveries = MessageService(db).delete_message(
        conversation_id=chat_id,
        message_id=message_id,
        current_user=current_user,
    )
    await _send_deliveries(manager, deliveries)
    return message


@router.post("/{chat_id}/read", response_model=ReadReceiptRead)
async def mark_read(
    chat_id: int,
    payload: ReadStatusUpdate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> ReadReceiptRead:
    manager: ConnectionManager = request.app.state.connection_manager
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
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    manager: ConnectionManager = request.app.state.connection_manager
    recipients, event = ChatService(db).publish_typing(
        conversation_id=chat_id,
        current_user=current_user,
        is_typing=payload.is_typing,
    )
    await manager.send_event(recipients, event)
    return {"accepted": True}
