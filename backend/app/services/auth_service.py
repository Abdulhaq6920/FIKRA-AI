"""
Authentication service.

Handles registration, login, logout, token refresh, and password reset.
All business logic for authentication lives here — route handlers are thin.

Security:
- Passwords are hashed with Argon2id.
- Access tokens are short-lived JWTs.
- Refresh tokens are random opaque strings stored as SHA-256 hashes.
- Login responses are generic to prevent account enumeration.
- Rate limiting is enforced at the route level (not duplicated here).
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    AuthenticationError,
    ConflictError,
    InvalidTokenError,
    NotFoundError,
    PermissionDeniedError,
)
from app.core.logging import get_logger
from app.core.security import (
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.db.models.user import OrgRole, OrganizationMembership, RefreshSession, User, UserStatus

logger = get_logger(__name__)


def _hash_refresh_token(token: str) -> str:
    """Store refresh tokens as SHA-256 hashes, never plaintext."""
    return hashlib.sha256(token.encode()).hexdigest()


class AuthService:
    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def register(
        self,
        email: str,
        password: str,
        full_name: str,
        organization_id: uuid.UUID,
    ) -> User:
        """
        Register a new user in an organization.

        Returns the created user (status=pending until email confirmed).
        Raises ConflictError if the email already exists.
        """
        email_normalized = email.strip().lower()

        existing = await self._db.scalar(
            select(User).where(User.email_normalized == email_normalized)
        )
        if existing:
            # Don't reveal whether the email exists — use a generic message
            # in real deployments. Here we raise ConflictError for the admin
            # registration flow; the public endpoint should map this to a
            # generic success response.
            raise ConflictError("Registration failed. Please try a different email.")

        user = User(
            email=email.strip(),
            email_normalized=email_normalized,
            hashed_password=hash_password(password),
            full_name=full_name.strip(),
            status=UserStatus.ACTIVE,  # For MVP; add email confirmation later
        )
        self._db.add(user)
        await self._db.flush()  # Get the generated user.id

        # Create membership in the organization
        membership = OrganizationMembership(
            user_id=user.id,
            organization_id=organization_id,
            role=OrgRole.MEMBER,
            is_active=True,
        )
        self._db.add(membership)
        await self._db.flush()

        logger.info("user_registered", user_id=str(user.id), org_id=str(organization_id))
        return user

    async def login(
        self,
        email: str,
        password: str,
        organization_id: uuid.UUID,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> tuple[str, str, User]:
        """
        Authenticate a user and return (access_token, refresh_token, user).

        Uses generic error messages to prevent account enumeration.
        """
        email_normalized = email.strip().lower()

        # Load user + membership together
        result = await self._db.execute(
            select(User, OrganizationMembership)
            .join(
                OrganizationMembership,
                (OrganizationMembership.user_id == User.id)
                & (OrganizationMembership.organization_id == organization_id)
                & (OrganizationMembership.is_active == True),  # noqa: E712
            )
            .where(User.email_normalized == email_normalized)
        )
        row = result.first()

        # Generic failure — do not distinguish between wrong email vs wrong password
        _GENERIC = "Invalid credentials."
        if row is None:
            raise AuthenticationError(_GENERIC)

        user, membership = row
        if not verify_password(password, user.hashed_password):
            logger.warning("login_failed_bad_password", email_normalized=email_normalized)
            raise AuthenticationError(_GENERIC)

        if user.status != UserStatus.ACTIVE:
            raise AuthenticationError("Account is not active.")

        # Opportunistically rehash if parameters are outdated
        if needs_rehash(user.hashed_password):
            user.hashed_password = hash_password(password)
            await self._db.flush()

        # Issue tokens
        access_token = create_access_token(
            subject=str(user.id),
            organization_id=str(organization_id),
            role=membership.role.value,
        )
        refresh_token = create_refresh_token()
        await self._create_refresh_session(
            user_id=user.id,
            refresh_token=refresh_token,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        logger.info(
            "login_success",
            user_id=str(user.id),
            org_id=str(organization_id),
            role=membership.role,
        )
        return access_token, refresh_token, user

    async def refresh(self, refresh_token: str) -> tuple[str, str]:
        """
        Validate a refresh token and issue a new access + refresh token pair.

        The old refresh token is revoked (rotation).
        Raises AuthenticationError on invalid or revoked token.
        """
        token_hash = _hash_refresh_token(refresh_token)
        session = await self._db.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == token_hash,
                RefreshSession.is_revoked == False,  # noqa: E712
            )
        )
        if session is None:
            raise AuthenticationError("Invalid or expired refresh token.")

        expires_at = session.expires_at
        # Ensure timezone-aware comparison
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise AuthenticationError("Refresh token has expired.")

        # Revoke old token
        session.is_revoked = True
        await self._db.flush()

        # Load user + their first active membership to rebuild the access token
        user = await self._db.get(User, session.user_id)
        if user is None or user.status != UserStatus.ACTIVE:
            raise AuthenticationError("Account not available.")

        membership = await self._db.scalar(
            select(OrganizationMembership).where(
                OrganizationMembership.user_id == user.id,
                OrganizationMembership.is_active == True,  # noqa: E712
            )
        )
        if membership is None:
            raise AuthenticationError("No active organization membership.")

        new_access = create_access_token(
            subject=str(user.id),
            organization_id=str(membership.organization_id),
            role=membership.role.value,
        )
        new_refresh = create_refresh_token()
        await self._create_refresh_session(user_id=user.id, refresh_token=new_refresh)

        return new_access, new_refresh

    async def logout(self, refresh_token: str) -> None:
        """Revoke the provided refresh token."""
        token_hash = _hash_refresh_token(refresh_token)
        session = await self._db.scalar(
            select(RefreshSession).where(RefreshSession.token_hash == token_hash)
        )
        if session:
            session.is_revoked = True
            await self._db.flush()

    async def initiate_password_reset(self, email: str) -> str | None:
        """
        Generate a password-reset token for the given email.

        Returns the token if the user exists (to be emailed).
        Returns None silently if the email is not found (prevents enumeration).
        """
        user = await self._db.scalar(
            select(User).where(User.email_normalized == email.strip().lower())
        )
        if user is None:
            return None

        reset_token = create_password_reset_token(str(user.id))
        # Store a hash of the token so we can later verify it
        user.password_reset_token = hashlib.sha256(reset_token.encode()).hexdigest()
        await self._db.flush()
        return reset_token

    async def complete_password_reset(self, token: str, new_password: str) -> None:
        """
        Validate a password-reset token and update the user's password.

        Raises InvalidTokenError if the token is invalid or expired.
        """
        try:
            payload = decode_token(token, expected_type="password_reset")
        except Exception as exc:
            raise InvalidTokenError() from exc

        user = await self._db.get(User, uuid.UUID(payload["sub"]))
        if user is None:
            raise InvalidTokenError()

        token_hash = hashlib.sha256(token.encode()).hexdigest()
        if user.password_reset_token != token_hash:
            raise InvalidTokenError()

        user.hashed_password = hash_password(new_password)
        user.password_reset_token = None  # Consume the token
        await self._db.flush()
        logger.info("password_reset_complete", user_id=str(user.id))

    async def _create_refresh_session(
        self,
        user_id: uuid.UUID,
        refresh_token: str,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.refresh_token_expire_days
        )
        session = RefreshSession(
            user_id=user_id,
            token_hash=_hash_refresh_token(refresh_token),
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )
        self._db.add(session)
        await self._db.flush()
