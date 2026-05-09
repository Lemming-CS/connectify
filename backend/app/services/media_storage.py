from __future__ import annotations

from dataclasses import dataclass
import hashlib
import mimetypes
import os
from pathlib import Path
import re
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from app.core.config import get_settings

IMAGE_MIME_TYPES = {
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
}
VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/quicktime",
    "video/webm",
}
AUDIO_MIME_TYPES = {
    "audio/aac",
    "audio/flac",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/wav",
    "audio/webm",
    "audio/x-wav",
}
FILE_MIME_TYPES = {
    "application/json",
    "application/octet-stream",
    "application/pdf",
    "application/zip",
    "text/csv",
    "text/plain",
}

SAFE_FILENAME_PATTERN = re.compile(r"[^A-Za-z0-9._-]+")


@dataclass
class StoredMedia:
    kind: str
    content_type: str
    storage_key: str
    original_filename: str
    size_bytes: int
    checksum_sha256: str
    width: int | None = None
    height: int | None = None
    duration_seconds: int | None = None


class LocalMediaStorage:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.root = Path(self.settings.media_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    async def save_upload(
        self,
        upload: UploadFile,
        *,
        uploader_id: int,
        is_voice_message: bool = False,
    ) -> StoredMedia:
        content_type = (upload.content_type or "").lower().strip()
        kind = self._infer_kind(content_type)
        if kind is None:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Unsupported media type",
            )
        if is_voice_message and kind != "audio":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Voice messages must use an audio upload",
            )

        original_filename = self._sanitize_filename(upload.filename)
        suffix = self._infer_suffix(original_filename, content_type)
        storage_key = f"{kind}/{uploader_id}/{uuid4().hex}{suffix}"
        destination = self.resolve_storage_path(storage_key)
        destination.parent.mkdir(parents=True, exist_ok=True)

        max_size_bytes = self._max_size_for_kind(kind)
        digest = hashlib.sha256()
        size_bytes = 0

        try:
            with destination.open("wb") as handle:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size_bytes += len(chunk)
                    if size_bytes > max_size_bytes:
                        raise HTTPException(
                            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                            detail="Uploaded file is too large",
                        )
                    digest.update(chunk)
                    handle.write(chunk)
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        finally:
            await upload.close()

        if size_bytes == 0:
            destination.unlink(missing_ok=True)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty",
            )

        return StoredMedia(
            kind=kind,
            content_type=content_type,
            storage_key=storage_key,
            original_filename=original_filename,
            size_bytes=size_bytes,
            checksum_sha256=digest.hexdigest(),
        )

    def resolve_storage_path(self, storage_key: str) -> Path:
        candidate = (self.root / storage_key).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid storage path",
            ) from exc
        return candidate

    def delete(self, storage_key: str) -> None:
        self.resolve_storage_path(storage_key).unlink(missing_ok=True)

    def _infer_kind(self, content_type: str) -> str | None:
        if content_type in IMAGE_MIME_TYPES:
            return "image"
        if content_type in VIDEO_MIME_TYPES:
            return "video"
        if content_type in AUDIO_MIME_TYPES:
            return "audio"
        if content_type in FILE_MIME_TYPES:
            return "file"
        return None

    def _max_size_for_kind(self, kind: str) -> int:
        if kind == "image":
            return self.settings.media_max_image_upload_bytes
        if kind == "video":
            return self.settings.media_max_video_upload_bytes
        if kind == "audio":
            return self.settings.media_max_audio_upload_bytes
        return self.settings.media_max_file_upload_bytes

    def _sanitize_filename(self, filename: str | None) -> str:
        raw_name = Path(filename or "upload.bin").name
        sanitized = SAFE_FILENAME_PATTERN.sub("_", raw_name).strip("._")
        return sanitized or "upload.bin"

    def _infer_suffix(self, original_filename: str, content_type: str) -> str:
        suffix = Path(original_filename).suffix[:16]
        if suffix:
            return suffix
        return mimetypes.guess_extension(content_type) or ""
