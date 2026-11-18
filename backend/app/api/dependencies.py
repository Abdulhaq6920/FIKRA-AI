"""
FastAPI dependency injection for authentication and authorization.

These dependencies are used as parameters in route handlers:

    async def my_endpoint(current_user: CurrentUser = Depends(require_user)):
        ...

Tenant context (organization_id) comes from the JWT claim,
never from a browser-supplied header or query parameter. The *role*, however,
is always read from the organization_memberships row — a token claim must never
be able to authorize a privileged action.

Security invariant:
- Every protected endpoint MUST use one of the Depends() functions here.
- Authorization is checked server-side on every request.
- Frontend route guards are NOT trusted as security boundaries.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Cookie, Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    AuthenticationError,
    InvalidTokenError,
    PermissionDeniedError,
    TokenExpiredError,
)
from app.core.security import decode_token
from app.db.models.user import OrganizationMembership, OrgRole, User, UserStatus
from app.db.session import get_db
from app.providers.groq_client import get_groq_client
from app.providers.llm import LLMClient
from app.providers.ollama_client import OllamaClient

_bearer = HTTPBearer(auto_error=False)


async def _get_token_payload(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    access_token: str | None = Cookie(default=None),
) -> dict:
    """
    Extract and validate the JWT from either:
    - Authorization: Bearer <token> header, OR
    - access_token HttpOnly cookie

    Cookie takes precedence in a browser context.
    """
    token: str | None = None

    if access_token:
        token = access_token
    elif credentials:
        token = credentials.credentials

    if not token:
        raise AuthenticationError("Authentication required.")

    return decode_token(token, expected_type="access")


async def get_current_user(
    payload: dict = Depends(_get_token_payload),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Return the authenticated User from the database."""
    user_id_str: str = payload.get("sub", "")
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError as exc:
        raise InvalidTokenError() from exc

    user = await db.get(User, user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise AuthenticationError("User account not found or inactive.")
    return user


async def get_current_user_and_org(
    request: Request,
    payload: dict = Depends(_get_token_payload),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, uuid.UUID, str]:
    """
    Return (user, organization_id, role) for the authenticated request.

    The JWT is only used to *identify* the user and the organization; the role
    comes from the ``organization_memberships`` row, which is the single source
    of truth for authorization. The token's ``role`` claim is never trusted: a
    demotion takes effect on the next request instead of when the access token
    expires.

    The membership must still exist and be active, so a removed or disabled
    member is rejected even while holding a valid, unexpired token.

    The identity is stamped onto ``request.state`` here — the one dependency
    every protected route passes through — so the access log and metrics can
    attribute *any* authenticated request. Stamping it only in ``require_user``
    left admin-only routes (documents, admin dashboard) logging ``user_id: null``.
    """
    user_id_str = payload.get("sub", "")
    org_id_str = payload.get("org", "")

    try:
        user_id = uuid.UUID(user_id_str)
        org_id = uuid.UUID(org_id_str)
    except ValueError as exc:
        raise InvalidTokenError() from exc

    user = await db.get(User, user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise AuthenticationError("User account not found or inactive.")

    # Verify the membership still exists and is active
    membership = await db.scalar(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.is_active == True,  # noqa: E712
        )
    )
    if membership is None:
        raise PermissionDeniedError("No active membership in this organization.")

    # Stamp identity for the access log and HTTP metrics. Done before the role
    # check so a 403 is still attributable to a real user.
    request.state.user_id = str(user.id)
    request.state.org_id = str(org_id)
    request.state.role = membership.role.value

    # Authorize on the database row, never on the claim.
    return user, org_id, membership.role.value


# ---------------------------------------------------------------------------
# Role-checked dependencies
# ---------------------------------------------------------------------------


async def require_user(
    ctx: tuple[User, uuid.UUID, str] = Depends(get_current_user_and_org),
) -> tuple[User, uuid.UUID, str]:
    """Any authenticated, active user with a valid membership.

    Identity is stamped onto ``request.state`` by ``get_current_user_and_org``,
    so the access log can attribute this request.
    """
    return ctx


async def require_org_admin(
    ctx: tuple[User, uuid.UUID, str] = Depends(get_current_user_and_org),
) -> tuple[User, uuid.UUID, str]:
    """
    Organization admin or platform admin.

    ``role`` is the membership role value (``OrgRole`` is a str enum, so the
    comparison holds), never the role claim from the token.
    """
    user, _org_id, role = ctx
    if role != OrgRole.ORG_ADMIN and not user.is_platform_admin:
        raise PermissionDeniedError("Organization admin role required.")
    return ctx


async def require_platform_admin(
    ctx: tuple[User, uuid.UUID, str] = Depends(get_current_user_and_org),
) -> tuple[User, uuid.UUID, str]:
    """Platform admin only."""
    user, org_id, role = ctx
    if not user.is_platform_admin:
        raise PermissionDeniedError("Platform admin role required.")
    return ctx


_ollama_client: OllamaClient | None = None


def get_llm_client() -> LLMClient:
    """Return the configured chat model provider."""
    global _ollama_client
    if settings.llm_provider == "ollama":
        if _ollama_client is None:
            _ollama_client = OllamaClient()
        return _ollama_client
    return get_groq_client()


# Type aliases for cleaner route signatures
CurrentUser = Annotated[tuple[User, uuid.UUID, str], Depends(require_user)]
OrgAdminUser = Annotated[tuple[User, uuid.UUID, str], Depends(require_org_admin)]
PlatformAdminUser = Annotated[tuple[User, uuid.UUID, str], Depends(require_platform_admin)]
