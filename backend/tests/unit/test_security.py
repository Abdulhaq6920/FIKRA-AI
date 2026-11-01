"""Unit tests for authentication and security helpers."""

from __future__ import annotations

import pytest

from app.core.security import (
    create_access_token,
    create_password_reset_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.core.exceptions import InvalidTokenError, TokenExpiredError


class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        hashed = hash_password("MyP@ss1")
        assert hashed != "MyP@ss1"
        assert len(hashed) > 20

    def test_verify_correct_password(self):
        hashed = hash_password("Secret1!")
        assert verify_password("Secret1!", hashed) is True

    def test_verify_wrong_password(self):
        hashed = hash_password("Secret1!")
        assert verify_password("Wrong1!", hashed) is False

    def test_two_hashes_are_different(self):
        """Argon2id uses a unique salt each time."""
        h1 = hash_password("Same1!")
        h2 = hash_password("Same1!")
        assert h1 != h2

    def test_verify_still_works_after_different_hashes(self):
        h1 = hash_password("Same1!")
        h2 = hash_password("Same1!")
        assert verify_password("Same1!", h1)
        assert verify_password("Same1!", h2)


class TestJWT:
    def test_access_token_round_trip(self):
        token = create_access_token(
            subject="user-123",
            organization_id="org-456",
            role="member",
        )
        payload = decode_token(token, expected_type="access")
        assert payload["sub"] == "user-123"
        assert payload["org"] == "org-456"
        assert payload["role"] == "member"
        assert payload["type"] == "access"

    def test_wrong_token_type_rejected(self):
        token = create_access_token(
            subject="user-123",
            organization_id="org-456",
            role="member",
        )
        with pytest.raises(InvalidTokenError):
            decode_token(token, expected_type="password_reset")

    def test_invalid_token_rejected(self):
        with pytest.raises(InvalidTokenError):
            decode_token("not.a.real.token")

    def test_password_reset_token_round_trip(self):
        token = create_password_reset_token("user-789")
        payload = decode_token(token, expected_type="password_reset")
        assert payload["sub"] == "user-789"
        assert payload["type"] == "password_reset"

    def test_tampered_token_rejected(self):
        token = create_access_token("u", "o", "member")
        tampered = token[:-4] + "XXXX"
        with pytest.raises(InvalidTokenError):
            decode_token(tampered)
