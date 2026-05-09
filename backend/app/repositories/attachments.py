from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Message, MessageAttachment


class AttachmentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, attachment_id: int) -> MessageAttachment | None:
        stmt = (
            select(MessageAttachment)
            .where(MessageAttachment.id == attachment_id)
            .options(
                selectinload(MessageAttachment.message).selectinload(Message.conversation),
                selectinload(MessageAttachment.uploader),
            )
        )
        return self.db.scalar(stmt)

    def create(
        self,
        *,
        message_id: int,
        uploader_id: int,
        kind: str,
        is_voice_message: bool,
        storage_key: str,
        original_filename: str | None,
        content_type: str | None,
        size_bytes: int,
        checksum_sha256: str | None,
        width: int | None = None,
        height: int | None = None,
        duration_seconds: int | None = None,
    ) -> MessageAttachment:
        attachment = MessageAttachment(
            message_id=message_id,
            uploader_id=uploader_id,
            kind=kind,
            status="ready",
            is_voice_message=is_voice_message,
            storage_key=storage_key,
            original_filename=original_filename,
            content_type=content_type,
            size_bytes=size_bytes,
            checksum_sha256=checksum_sha256,
            width=width,
            height=height,
            duration_seconds=duration_seconds,
        )
        self.db.add(attachment)
        self.db.flush()
        return attachment
