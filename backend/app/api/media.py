from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.attachments import AttachmentService

router = APIRouter(prefix="/media", tags=["media"])


@router.get("/attachments/{attachment_id}")
async def read_attachment(
    attachment_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
    download: bool = Query(default=False),
) -> StreamingResponse:
    attachment, path = AttachmentService(db).get_attachment_file(
        attachment_id=attachment_id,
        current_user=current_user,
    )
    inline_media = {"audio", "image", "video"}
    content_disposition_type = "attachment" if download or attachment.kind not in inline_media else "inline"
    filename = attachment.original_filename or f"attachment-{attachment.id}"
    response = StreamingResponse(
        _iterate_file(path),
        media_type=attachment.content_type,
    )
    response.headers["Content-Disposition"] = f'{content_disposition_type}; filename="{filename}"'
    return response


def _iterate_file(path: Path) -> Iterator[bytes]:
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(64 * 1024)
            if not chunk:
                break
            yield chunk
