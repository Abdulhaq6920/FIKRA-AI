"""
SQLAlchemy type for transparent field-level encryption.

EncryptedType encrypts values before writing to the database and decrypts
them on read. The rest of the application works with plaintext strings;
encryption is entirely transparent.

Usage in a model:

    from app.db.types.encrypted import EncryptedType

    class User(Base):
        email: Mapped[str] = mapped_column(EncryptedType(String(320)), unique=True, nullable=False)

The underlying database column stores ciphertext (base64-encoded Fernet
tokens), so the column type should be large enough to hold the encrypted
output (Fernet tokens are ~1.5x the plaintext length).

Requires DATA_ENCRYPTION_KEY to be set in the environment.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

from app.core.config import settings
from app.core.encryption import decrypt, encrypt
from app.core.logging import get_logger

logger = get_logger(__name__)


class EncryptedType(TypeDecorator):
    """
    Transparent field-level encryption for SQLAlchemy models.

    Stores ciphertext in the database; returns plaintext to the application.

    Rows written before encryption was enabled (or by raw-SQL scripts) are
    returned as-is when they cannot be decrypted, so a migration never
    bricks existing data.
    """

    impl = String
    cache_ok = True

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        # Ensure the underlying column is large enough for Fernet ciphertext.
        # Fernet tokens are base64-encoded and roughly 1.5x the plaintext.
        if "length" not in kwargs and not args:
            kwargs["length"] = 4096
        super().__init__(*args, **kwargs)

    def process_bind_param(self: EncryptedType, value: Any, dialect: Any) -> Any:
        """Encrypt before writing to the database."""
        if value is None:
            return None
        return encrypt_value(str(value))

    def process_result_value(self: EncryptedType, value: Any, dialect: Any) -> Any:
        """Decrypt after reading from the database."""
        if value is None:
            return None
        return decrypt_value(value)


def encrypt_value(plaintext: str) -> str:
    """Encrypt a value, returning plaintext unchanged when no key is set.

    This keeps local development and tests working without forcing a key,
    while production (which sets DATA_ENCRYPTION_KEY) encrypts everything.
    """
    if not settings.data_encryption_key:
        return plaintext
    return encrypt(plaintext)


def decrypt_value(ciphertext: str) -> str:
    """Decrypt a value; returns it unchanged if it is not ciphertext."""
    if not settings.data_encryption_key:
        return ciphertext
    try:
        return decrypt(ciphertext)
    except Exception:
        # Pre-encryption rows (or raw-SQL writes) are not Fernet tokens.
        logger.debug("encrypted_field_not_ciphertext")
        return ciphertext
