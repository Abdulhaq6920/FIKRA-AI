"""
Authentication and authorization helpers.

Responsibilities:
- Password hashing with Argon2id
- JWT access-token creation and verification
- Refresh-token generation
- Dependency factories for FastAPI route protection
- NEVER exposes passwords, hashes, or raw tokens in logs or responses
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.exceptions import InvalidTokenError, TokenExpiredError

# ---------------------------------------------------------------------------
# Password hashing — Argon2id
# ---------------------------------------------------------------------------
_pwd_context = CryptContext(
    schemes=["argon2"],
    deprecated="auto",
    argon2__memory_cost=65536,   # 64 MB
    argon2__time_cost=3,
    argon2__parallelism=4,
)


def hash_password(plain: str) -> str:
    """Return the Argon2id hash of *plain*. Never store the plaintext."""
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches *hashed*. Constant-time comparison."""
    return _pwd_context.verify(plain, hashed)


def needs_rehash(hashed: str) -> bool:
    """Return True when the stored hash uses outdated parameters."""
    return _pwd_context.needs_update(hashed)


# ---------------------------------------------------------------------------
# JWT tokens
# ---------------------------------------------------------------------------
_ALGORITHM = settings.jwt_algorithm


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    subject: str,
    organization_id: str,
    role: str,
    *,
    expires_delta: timedelta | None = None,
) -> str:
    """
    Create a signed JWT access token.

    Payload:
        sub   — user ID (UUID string)
        org   — organization ID (UUID string)
        role  — user role within the organization
        type  — "access"
        iat   — issued-at (UTC epoch seconds)
        exp   — expiry (UTC epoch seconds)
        jti   — unique token ID for revocation tracking
    """
    expire = _utcnow() + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload: dict[str, Any] = {
        "sub": subject,
        "org": organization_id,
        "role": role,
        "type": "access",
        "iat": _utcnow(),
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=_ALGORITHM)


def create_refresh_token() -> str:
    """Return a cryptographically secure random refresh token (not a JWT)."""
    return secrets.token_urlsafe(64)


def create_password_reset_token(user_id: str) -> str:
    """Short-lived JWT used only for password-reset email links."""
    expire = _utcnow() + timedelta(minutes=30)
    payload: dict[str, Any] = {
        "sub": user_id,
        "type": "password_reset",
        "iat": _utcnow(),
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=_ALGORITHM)


def decode_token(token: str, *, expected_type: str = "access") -> dict[str, Any]:
    """
    Decode and validate a JWT.

    Raises:
        TokenExpiredError  — token is past its expiry
        InvalidTokenError  — signature invalid, malformed, wrong type
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "type"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError() from exc
    except jwt.PyJWTError as exc:
        raise InvalidTokenError() from exc

    if payload.get("type") != expected_type:
        raise InvalidTokenError(f"Expected token type '{expected_type}'")

    return payload


def generate_api_key() -> str:
    """Generate a random API key for service-to-service use."""
    return f"fikra_{secrets.token_urlsafe(40)}"
