from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.notifications import NotificationClearResult, NotificationRead
from app.services.notifications import NotificationService, RealtimeDelivery
from app.services.realtime import ConnectionManager

router = APIRouter(prefix="/notifications", tags=["notifications"])


async def _send_deliveries(manager: ConnectionManager, deliveries: list[RealtimeDelivery]) -> None:
    for delivery in deliveries:
        await manager.send_event(delivery.recipients, delivery.event)


@router.get("", response_model=list[NotificationRead])
async def list_notifications(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    unread_only: bool = Query(default=True),
) -> list[NotificationRead]:
    return NotificationService(db).list_notifications(current_user=current_user, unread_only=unread_only)


@router.post("/{notification_id}/read", response_model=NotificationRead)
async def mark_notification_read(
    notification_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> NotificationRead:
    manager: ConnectionManager = request.app.state.connection_manager
    notification, deliveries = NotificationService(db).mark_read(
        current_user=current_user,
        notification_id=notification_id,
    )
    await _send_deliveries(manager, deliveries)
    return notification


@router.post("/read-all", response_model=list[NotificationRead], status_code=status.HTTP_200_OK)
async def mark_all_notifications_read(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> list[NotificationRead]:
    manager: ConnectionManager = request.app.state.connection_manager
    notifications, deliveries = NotificationService(db).mark_all_read(current_user=current_user)
    await _send_deliveries(manager, deliveries)
    return notifications


@router.delete("/{notification_id}", response_model=NotificationClearResult)
async def clear_notification(
    notification_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> NotificationClearResult:
    manager: ConnectionManager = request.app.state.connection_manager
    cleared_count, deliveries = NotificationService(db).clear_notification(
        current_user=current_user,
        notification_id=notification_id,
    )
    await _send_deliveries(manager, deliveries)
    return NotificationClearResult(cleared_count=cleared_count)


@router.delete("", response_model=NotificationClearResult)
async def clear_all_notifications(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> NotificationClearResult:
    manager: ConnectionManager = request.app.state.connection_manager
    cleared_count, deliveries = NotificationService(db).clear_all_notifications(current_user=current_user)
    await _send_deliveries(manager, deliveries)
    return NotificationClearResult(cleared_count=cleared_count)
