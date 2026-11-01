"""
Storage abstraction interface.

The application uses this interface for all file storage operations.
The local implementation stores files on disk.
A future S3 implementation can be swapped in without changing any service code.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class StorageBackend(ABC):
    """Abstract base class for file storage backends."""

    @abstractmethod
    async def save(
        self,
        data: bytes,
        storage_path: str,
    ) -> str:
        """
        Persist *data* at *storage_path*.

        Returns the canonical storage path (may differ from input on collision).
        Raises StorageError on failure.
        """

    @abstractmethod
    async def read(self, storage_path: str) -> bytes:
        """Return the raw bytes at *storage_path*. Raises StorageError if missing."""

    @abstractmethod
    async def delete(self, storage_path: str) -> None:
        """Delete the file at *storage_path*. No-op if the file does not exist."""

    @abstractmethod
    async def exists(self, storage_path: str) -> bool:
        """Return True if *storage_path* exists."""

    @abstractmethod
    def public_url(self, storage_path: str) -> str | None:
        """
        Return a URL for serving the file, or None if not publicly accessible.
        Used to build download links in API responses.
        """


class StorageError(Exception):
    """Raised when a storage operation fails."""
