"""
Vercel Blob implementation of the StorageBackend interface.

The SDK resolves credentials in this order: the Vercel-injected OIDC token
paired with ``BLOB_STORE_ID``, then ``BLOB_READ_WRITE_TOKEN``. This module is
only imported when STORAGE_BACKEND=vercel_blob, so local/Docker deployments do
not need Blob credentials.
"""

from __future__ import annotations

from typing import Literal

from vercel import blob
from vercel.blob import BlobError, BlobNotFoundError

from app.core.config import settings
from app.core.logging import get_logger
from app.storage.interface import StorageBackend, StorageError

logger = get_logger(__name__)


class VercelBlobStorageBackend(StorageBackend):
    """Store document bytes in a connected Vercel Blob store."""

    @property
    def _access(self) -> Literal["public", "private"]:
        return "public" if settings.blob_access == "public" else "private"

    async def save(self, data: bytes, storage_path: str) -> str:
        try:
            result = await blob.put_blob(
                storage_path,
                data,
                access=self._access,
                allow_overwrite=True,
            )
        except BlobError as exc:
            raise StorageError(f"Blob upload failed: {exc}") from exc
        logger.info("blob_saved", path=result.pathname)
        return result.pathname

    async def read(self, storage_path: str) -> bytes:
        try:
            result = await blob.get_blob(storage_path, access=self._access)
        except BlobNotFoundError as exc:
            raise StorageError(f"Blob not found: {storage_path}") from exc
        except BlobError as exc:
            raise StorageError(f"Blob read failed: {exc}") from exc
        return result.body

    async def delete(self, storage_path: str) -> None:
        try:
            await blob.delete_blob(storage_path)
        except BlobError as exc:
            raise StorageError(f"Blob delete failed: {exc}") from exc

    async def exists(self, storage_path: str) -> bool:
        try:
            await blob.head_blob(storage_path)
        except BlobNotFoundError:
            return False
        except BlobError as exc:
            raise StorageError(f"Blob metadata lookup failed: {exc}") from exc
        return True

    def public_url(self, storage_path: str) -> str | None:
        if self._access != "public" or not settings.blob_store_id:
            return None
        store_id = settings.blob_store_id.removeprefix("store_")
        return f"https://{store_id}.public.blob.vercel-storage.com/{storage_path}"
