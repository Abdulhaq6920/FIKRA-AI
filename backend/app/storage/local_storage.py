"""
Local disk storage backend.

Files are stored under UPLOAD_DIR, organized by tenant and document ID
to prevent path collisions and simplify per-tenant cleanup.

Security:
- Storage paths are generated server-side (UUID-based), never from user input.
- Path traversal is prevented by resolving paths against the base directory.
- Files are served only through authenticated API endpoints, not as static files.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import aiofiles

from app.core.config import settings
from app.core.logging import get_logger
from app.storage.interface import StorageBackend, StorageError

logger = get_logger(__name__)


class LocalStorageBackend(StorageBackend):
    """
    Stores uploaded files on the local filesystem.

    File layout: {base_dir}/{org_id}/{doc_id}/{filename}
    """

    def __init__(self, base_dir: str | None = None) -> None:
        self._base = Path(base_dir or settings.upload_dir).resolve()
        self._base.mkdir(parents=True, exist_ok=True)
        logger.info("local_storage_initialized", path=str(self._base))

    def _resolve(self, storage_path: str) -> Path:
        """
        Resolve *storage_path* against the base directory.

        Raises StorageError if the resolved path escapes the base directory
        (path traversal protection).
        """
        resolved = (self._base / storage_path).resolve()
        # is_relative_to is the correct traversal check — a string prefix
        # match would accept sibling directories like {base}2/.
        if not resolved.is_relative_to(self._base):
            raise StorageError(f"Path traversal detected: {storage_path!r}")
        return resolved

    async def save(self, data: bytes, storage_path: str) -> str:
        target = self._resolve(storage_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            async with aiofiles.open(target, "wb") as fh:
                await fh.write(data)
        except OSError as exc:
            raise StorageError(f"Failed to save file: {exc}") from exc
        logger.debug("file_saved", path=storage_path, size=len(data))
        return storage_path

    async def read(self, storage_path: str) -> bytes:
        target = self._resolve(storage_path)
        if not target.exists():
            raise StorageError(f"File not found: {storage_path!r}")
        try:
            async with aiofiles.open(target, "rb") as fh:
                return await fh.read()
        except OSError as exc:
            raise StorageError(f"Failed to read file: {exc}") from exc

    async def delete(self, storage_path: str) -> None:
        target = self._resolve(storage_path)
        if target.exists():
            await asyncio.to_thread(target.unlink)
            # Uploads use an isolated {org_id}/{document_id}/ directory.
            # Remove empty container directories so no local file trace remains.
            await asyncio.to_thread(self._remove_empty_parents, target.parent)
            logger.debug("file_deleted", path=storage_path)

    def _remove_empty_parents(self, directory: Path) -> None:
        """Remove empty upload directories without ever traversing above base."""
        current = directory
        while current != self._base:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    async def exists(self, storage_path: str) -> bool:
        target = self._resolve(storage_path)
        return target.exists()

    def public_url(self, storage_path: str) -> str | None:
        # Local storage is not publicly accessible.
        # Files are served via /api/v1/documents/{id}/download
        return None


# Application singleton
_storage: LocalStorageBackend | None = None


def get_storage() -> LocalStorageBackend:
    global _storage
    if _storage is None:
        _storage = LocalStorageBackend()
    return _storage
