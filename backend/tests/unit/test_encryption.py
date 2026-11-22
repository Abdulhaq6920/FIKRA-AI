"""Unit tests for data-at-rest encryption (Fernet) and the encrypted column type."""

from __future__ import annotations

import pytest
from cryptography.fernet import Fernet

from app.core.encryption import decrypt, encrypt
from app.db.types.encrypted import decrypt_value, encrypt_value


@pytest.fixture
def key(monkeypatch: pytest.MonkeyPatch) -> str:
    """Install a deterministic Fernet key in settings for the test."""
    generated = Fernet.generate_key().decode()
    monkeypatch.setattr("app.core.encryption.settings.data_encryption_key", generated)
    monkeypatch.setattr("app.db.types.encrypted.settings.data_encryption_key", generated)
    return generated


class TestEncryption:
    def test_round_trip(self, key: str):
        ciphertext = encrypt("admin@fikra.ai")
        assert ciphertext != "admin@fikra.ai"
        assert decrypt(ciphertext) == "admin@fikra.ai"

    def test_ciphertext_is_nondeterministic(self, key: str):
        """Fernet uses a random IV, so equal plaintexts produce different tokens."""
        assert encrypt("same") != encrypt("same")

    def test_empty_values_pass_through(self, key: str):
        assert encrypt("") == ""
        assert decrypt("") == ""

    def test_decrypt_rejects_tampered_token(self, key: str):
        with pytest.raises(Exception):
            decrypt("not-a-fernet-token")


class TestEncryptedTypeHelpers:
    def test_encrypt_value_without_key_is_noop(self, monkeypatch: pytest.MonkeyPatch):
        """Local dev/tests without DATA_ENCRYPTION_KEY must keep working."""
        monkeypatch.setattr("app.db.types.encrypted.settings.data_encryption_key", "")
        assert encrypt_value("plain") == "plain"

    def test_decrypt_value_without_key_is_noop(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setattr("app.db.types.encrypted.settings.data_encryption_key", "")
        assert decrypt_value("plain") == "plain"

    def test_encrypt_value_with_key(self, key: str):
        assert encrypt_value("secret") != "secret"
        assert decrypt_value(encrypt_value("secret")) == "secret"

    def test_decrypt_value_tolerates_plaintext_rows(self, key: str):
        """Rows written before encryption was enabled must still read."""
        assert decrypt_value("legacy-plaintext@example.com") == "legacy-plaintext@example.com"
