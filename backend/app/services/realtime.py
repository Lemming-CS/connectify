from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
import queue
import threading

from fastapi import WebSocket


@dataclass(frozen=True)
class RealtimeDelivery:
    recipients: list[int]
    event: dict[str, object]


class ManagedWebSocket:
    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket
        self.events: queue.Queue[dict[str, object] | None] = queue.Queue()

    def enqueue(self, payload: dict[str, object]) -> None:
        self.events.put_nowait(payload)

    def close(self) -> None:
        self.events.put_nowait(None)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, list[ManagedWebSocket]] = defaultdict(list)
        self._lock = threading.Lock()

    async def connect(self, user_id: int, websocket: WebSocket) -> ManagedWebSocket:
        await websocket.accept()
        managed = ManagedWebSocket(websocket)
        with self._lock:
            self._connections[user_id].append(managed)
        return managed

    async def disconnect(self, user_id: int, managed: ManagedWebSocket) -> None:
        with self._lock:
            connections = self._connections.get(user_id)
            if not connections:
                return
            self._connections[user_id] = [item for item in connections if item is not managed]
            if not self._connections[user_id]:
                self._connections.pop(user_id, None)
        managed.close()

    async def send_event(self, user_ids: Iterable[int], event: dict[str, object]) -> None:
        unique_ids = set(user_ids)
        with self._lock:
            targets = {
                user_id: list(self._connections.get(user_id, []))
                for user_id in unique_ids
            }

        for sockets in targets.values():
            for managed in sockets:
                managed.enqueue(event)
