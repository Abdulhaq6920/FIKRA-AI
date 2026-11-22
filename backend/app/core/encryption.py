"""
Data-at-rest encryption for sensitive database fields.

Uses Fernet (symmetric encryption) from the cryptography library.
The encryption key is loaded from the DATA_ENCRYPTION_KEY environment
variable and must be a URL-safe base64-encoded 32-byte key.

Generate a key:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Set it in .env:
    DATA_ENCRYPTION_KEY=<your-base64-key>

All sensitive fields (email, document content, conversation text, etc.)
are encrypted before being written to the database and decrypted on read.
The encryption is transparent to the rest of the application via a
SQLAlchemy TypeDecorator (see app/db/types/encrypted.py).
"""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from cryptography.fernet import Fernet as FernetType

logger = get_logger(__name__)

_cipher: FernetType | None = None


def _get_cipher() -> FernetType:
    """Lazy-initialize the Fernet cipher from DATA_ENCRYPTION_KEY."""
    global _cipher
    if _cipher is None:
        key = settings.data_encryption_key
        if not key:
            raise RuntimeError(
                "DATA_ENCRYPTION_KEY is not configured. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
                "and set it in .env."
            )
        try:
            _cipher = Fernet(key.encode() if isinstance(key, str) else key)
        except (ValueError, TypeError) as exc:
            logger.error("data_encryption_key_invalid", error=str(exc))
            raise RuntimeError(
                "DATA_ENCRYPTION_KEY is invalid. It must be a URL-safe "
                "base64-encoded 32-byte key."
            ) from exc
    return _cipher


def encrypt(plaintext: str) -> str:
    """Encrypt a string and return a base64-encoded ciphertext."""
    if not plaintext:
        return plaintext
    cipher = _get_cipher()
    token = cipher.encrypt(plaintext.encode("utf-8"))
    return token.decode("utf-8")


def decrypt(ciphertext: str) -> str:
    """Decrypt a base64-encoded ciphertext and return the plaintext."""
    if not ciphertext:
        return ciphertext
    cipher = _get_cipher()
    try:
        token = ciphertext.encode("utf-8") if isinstance(ciphertext, str) else ciphertext
        return cipher.decrypt(token).decode("utf-8")
    except InvalidToken as exc:
        logger.error("data_decryption_failed", error="invalid_token")
        raise RuntimeError("Failed to decrypt data — the encryption key may have changed.") from exc


def rotate_key(old_key: str, new_key: str) -> None:
    """
    Placeholder for future key rotation support.

    To rotate keys: decrypt all fields with the old key, re-encrypt with the
    new key, and update DATA_ENCRYPTION_KEY.
    """
    raise NotImplementedError("Key rotation is not yet implemented.")
