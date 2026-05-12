from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import CallSession, Conversation, ConversationMember
from app.models.user import User
from app.repositories.calls import CallRepository
from app.repositories.conversations import ConversationRepository
from app.schemas.calls import CallRead
from app.services.realtime import RealtimeDelivery


class CallService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.calls = CallRepository(db)
        self.conversations = ConversationRepository(db)

    def list_calls(
        self,
        *,
        conversation_id: int,
        current_user: User,
    ) -> list[CallRead]:
        conversation, _, _ = self._get_direct_conversation_context(conversation_id, current_user.id)
        calls = self.calls.list_for_conversation(conversation.id)
        return [self._serialize_call(call) for call in calls]

    def get_call(
        self,
        *,
        call_id: int,
        current_user: User,
    ) -> CallRead:
        call, _, _ = self._get_call_with_context(call_id, current_user.id)
        return self._serialize_call(call)

    def start_call(
        self,
        *,
        conversation_id: int,
        current_user: User,
        kind: str,
    ) -> tuple[CallRead, list[RealtimeDelivery]]:
        conversation, _, callee = self._get_direct_conversation_context(conversation_id, current_user.id)

        open_call = self.calls.get_open_for_conversation(conversation.id)
        if open_call is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another call is already in progress for this chat",
            )

        call = self.calls.create(
            conversation_id=conversation.id,
            caller_id=current_user.id,
            callee_id=callee.user_id,
            kind=kind,
            metadata={"transport": "webrtc-signaling-only"},
        )
        self.db.commit()
        refreshed = self.calls.get_by_id(call.id)
        if refreshed is None:
            raise RuntimeError("call was created but could not be reloaded")

        call_read = self._serialize_call(refreshed)
        deliveries = [
            RealtimeDelivery(
                recipients=[current_user.id, callee.user_id],
                event={
                    "type": "call.created",
                    "conversation_id": conversation.id,
                    "payload": call_read.model_dump(mode="json"),
                },
            )
        ]
        return call_read, deliveries

    def accept_call(
        self,
        *,
        call_id: int,
        current_user: User,
    ) -> tuple[CallRead, list[RealtimeDelivery]]:
        call, _, _ = self._get_call_with_context(call_id, current_user.id)
        if current_user.id != call.callee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the callee can accept this call",
            )
        if call.status != "ringing":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only ringing calls can be accepted",
            )

        call.status = "active"
        call.accepted_at = datetime.now(UTC)
        self.db.add(call)
        self.db.commit()
        self.db.refresh(call)

        call_read = self._serialize_call(call)
        return call_read, self._status_update_deliveries(call_read)

    def reject_call(
        self,
        *,
        call_id: int,
        current_user: User,
    ) -> tuple[CallRead, list[RealtimeDelivery]]:
        call, _, _ = self._get_call_with_context(call_id, current_user.id)
        if current_user.id != call.callee_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the callee can reject this call",
            )
        if call.status != "ringing":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only ringing calls can be rejected",
            )

        call.status = "rejected"
        call.ended_by_id = current_user.id
        call.ended_at = datetime.now(UTC)
        self.db.add(call)
        self.db.commit()
        self.db.refresh(call)

        call_read = self._serialize_call(call)
        return call_read, self._status_update_deliveries(call_read)

    def end_call(
        self,
        *,
        call_id: int,
        current_user: User,
    ) -> tuple[CallRead, list[RealtimeDelivery]]:
        call, _, _ = self._get_call_with_context(call_id, current_user.id)
        if current_user.id not in {call.caller_id, call.callee_id}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this call",
            )

        if call.status == "active":
            call.status = "ended"
        elif call.status == "ringing" and current_user.id == call.caller_id:
            call.status = "canceled"
        else:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This call cannot be ended from its current state",
            )

        call.ended_by_id = current_user.id
        call.ended_at = datetime.now(UTC)
        self.db.add(call)
        self.db.commit()
        self.db.refresh(call)

        call_read = self._serialize_call(call)
        return call_read, self._status_update_deliveries(call_read)

    def send_signal(
        self,
        *,
        call_id: int,
        current_user: User,
        signal_type: str,
        payload: dict[str, object],
    ) -> list[RealtimeDelivery]:
        call, _, _ = self._get_call_with_context(call_id, current_user.id)
        if current_user.id not in {call.caller_id, call.callee_id}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this call",
            )
        if call.status not in {"ringing", "active"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Signaling is only available while a call is open",
            )

        target_user_id = call.callee_id if current_user.id == call.caller_id else call.caller_id
        return [
            RealtimeDelivery(
                recipients=[target_user_id],
                event={
                    "type": "call.signal",
                    "conversation_id": call.conversation_id,
                    "payload": {
                        "call_id": call.id,
                        "signal_type": signal_type,
                        "from_user_id": current_user.id,
                        "payload": payload,
                    },
                },
            )
        ]

    def _get_direct_conversation_context(
        self,
        conversation_id: int,
        user_id: int,
    ) -> tuple[Conversation, ConversationMember, ConversationMember]:
        conversation = self.conversations.get_by_id(conversation_id)
        if conversation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        if conversation.kind != "direct":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Calls are only available in direct chats",
            )

        member = self.conversations.get_active_member(conversation_id, user_id)
        if member is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this chat",
            )

        active_members = [item for item in conversation.members if item.left_at is None]
        other_members = [item for item in active_members if item.user_id != user_id]
        if len(other_members) != 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This chat is not in a callable state",
            )
        return conversation, member, other_members[0]

    def _get_call_with_context(
        self,
        call_id: int,
        user_id: int,
    ) -> tuple[CallSession, Conversation, ConversationMember]:
        call = self.calls.get_by_id(call_id)
        if call is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Call not found",
            )

        conversation, member, _ = self._get_direct_conversation_context(call.conversation_id, user_id)
        if user_id not in {call.caller_id, call.callee_id}:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to this call",
            )
        return call, conversation, member

    def _status_update_deliveries(self, call: CallRead) -> list[RealtimeDelivery]:
        return [
            RealtimeDelivery(
                recipients=[call.caller.id, call.callee.id],
                event={
                    "type": "call.updated",
                    "conversation_id": call.conversation_id,
                    "payload": call.model_dump(mode="json"),
                },
            )
        ]

    def _serialize_call(self, call: CallSession) -> CallRead:
        return CallRead(
            id=call.id,
            conversation_id=call.conversation_id,
            caller={
                "id": call.caller.id,
                "username": call.caller.username,
                "avatar_url": call.caller.avatar_url,
            },
            callee={
                "id": call.callee.id,
                "username": call.callee.username,
                "avatar_url": call.callee.avatar_url,
            },
            ended_by_id=call.ended_by_id,
            kind=call.kind,
            status=call.status,
            metadata=call.details or {},
            created_at=call.created_at,
            accepted_at=call.accepted_at,
            ended_at=call.ended_at,
        )
