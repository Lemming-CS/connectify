import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.api.deps import get_user_from_token
from app.core.database import get_sessionmaker
from app.services.realtime import ConnectionManager

router = APIRouter(tags=["realtime"])


def _extract_token(websocket: WebSocket) -> str | None:
    token = websocket.query_params.get("token")
    if token:
        return token

    authorization = websocket.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


@router.websocket("/realtime/ws")
async def realtime_websocket(websocket: WebSocket) -> None:
    token = _extract_token(websocket)
    sessionmaker = getattr(websocket.app.state, "sessionmaker", None) or get_sessionmaker()
    session = sessionmaker()
    try:
        user = get_user_from_token(token, session)
    finally:
        session.close()

    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    manager: ConnectionManager = websocket.app.state.connection_manager
    managed = await manager.connect(user.id, websocket)

    async def receive_loop() -> None:
        while True:
            message = await websocket.receive_json()
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    async def send_loop() -> None:
        while True:
            event = await asyncio.to_thread(managed.events.get)
            if event is None:
                return
            await websocket.send_json(event)

    try:
        receive_task = asyncio.create_task(receive_loop())
        send_task = asyncio.create_task(send_loop())
        done, pending = await asyncio.wait(
            {receive_task, send_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)

        for task in done:
            exception = task.exception()
            if exception is not None and not isinstance(exception, WebSocketDisconnect):
                raise exception
    finally:
        await manager.disconnect(user.id, managed)
