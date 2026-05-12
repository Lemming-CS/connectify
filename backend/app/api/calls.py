from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.calls import CallRead, CallSignalAccepted, CallSignalCreate
from app.services.calls import CallService
from app.services.realtime import ConnectionManager, RealtimeDelivery

router = APIRouter(prefix="/calls", tags=["calls"])


async def _send_deliveries(manager: ConnectionManager, deliveries: list[RealtimeDelivery]) -> None:
    for delivery in deliveries:
        await manager.send_event(delivery.recipients, delivery.event)


@router.get("/{call_id}", response_model=CallRead)
async def get_call(
    call_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> CallRead:
    return CallService(db).get_call(call_id=call_id, current_user=current_user)


@router.post("/{call_id}/accept", response_model=CallRead)
async def accept_call(
    call_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> CallRead:
    manager: ConnectionManager = request.app.state.connection_manager
    call, deliveries = CallService(db).accept_call(call_id=call_id, current_user=current_user)
    await _send_deliveries(manager, deliveries)
    return call


@router.post("/{call_id}/reject", response_model=CallRead)
async def reject_call(
    call_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> CallRead:
    manager: ConnectionManager = request.app.state.connection_manager
    call, deliveries = CallService(db).reject_call(call_id=call_id, current_user=current_user)
    await _send_deliveries(manager, deliveries)
    return call


@router.post("/{call_id}/end", response_model=CallRead)
async def end_call(
    call_id: int,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> CallRead:
    manager: ConnectionManager = request.app.state.connection_manager
    call, deliveries = CallService(db).end_call(call_id=call_id, current_user=current_user)
    await _send_deliveries(manager, deliveries)
    return call


@router.post("/{call_id}/signal", response_model=CallSignalAccepted, status_code=status.HTTP_202_ACCEPTED)
async def send_call_signal(
    call_id: int,
    payload: CallSignalCreate,
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> CallSignalAccepted:
    manager: ConnectionManager = request.app.state.connection_manager
    deliveries = CallService(db).send_signal(
        call_id=call_id,
        current_user=current_user,
        signal_type=payload.signal_type,
        payload=payload.payload,
    )
    await _send_deliveries(manager, deliveries)
    return CallSignalAccepted(accepted=True)
