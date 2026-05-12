from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import CallSession


class CallRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, call_id: int) -> CallSession | None:
        return self.db.scalar(self._base_query().where(CallSession.id == call_id))

    def list_for_conversation(self, conversation_id: int) -> list[CallSession]:
        stmt = (
            self._base_query()
            .where(CallSession.conversation_id == conversation_id)
            .order_by(CallSession.created_at.desc(), CallSession.id.desc())
        )
        return list(self.db.scalars(stmt))

    def get_open_for_conversation(self, conversation_id: int) -> CallSession | None:
        stmt = self._base_query().where(
            CallSession.conversation_id == conversation_id,
            CallSession.status.in_(("ringing", "active")),
        )
        return self.db.scalar(stmt)

    def create(
        self,
        *,
        conversation_id: int,
        caller_id: int,
        callee_id: int,
        kind: str,
        metadata: dict[str, object] | None = None,
    ) -> CallSession:
        call = CallSession(
            conversation_id=conversation_id,
            caller_id=caller_id,
            callee_id=callee_id,
            kind=kind,
            details=metadata or {},
        )
        self.db.add(call)
        self.db.flush()
        return call

    def _base_query(self):
        return select(CallSession).options(
            selectinload(CallSession.caller),
            selectinload(CallSession.callee),
            selectinload(CallSession.ended_by),
        )
