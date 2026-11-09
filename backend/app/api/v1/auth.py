"""
Authentication API endpoints.

GET  /api/v1/auth/signup-options
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
POST /api/v1/auth/refresh
POST /api/v1/auth/password-reset/initiate
POST /api/v1/auth/password-reset/complete
GET  /api/v1/auth/me
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.config import settings
from app.core.exceptions import ConflictError, ValidationError
from app.db.session import get_db
from app.schemas.auth import (
    LoginRequest,
    PasswordResetCompleteRequest,
    PasswordResetInitRequest,
    PublicOrganization,
    RegisterRequest,
    SignupOptionsResponse,
    TokenResponse,
    UserPublic,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

# The refresh-token cookie fallback body must stay tiny (caps DoS surface).
_MAX_REFRESH_BODY_BYTES = 4096


@router.get("/signup-options", response_model=SignupOptionsResponse)
async def signup_options(
    db: AsyncSession = Depends(get_db),
) -> SignupOptionsResponse:
    """
    List organizations that accept public self-registration.

    Public by design — the sign-up form needs it before any account exists
    (fixes the previously hard-coded default organization UUID in the UI).
    Only allowlisted organizations are ever returned.
    """
    options = await AuthService(db).signup_options()
    return SignupOptionsResponse(
        organizations=[PublicOrganization(id=org_id, name=name) for org_id, name in options]
    )


@router.post("/register", response_model=UserPublic, status_code=201)
async def register(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> UserPublic:
    """Register a new user in an organization."""
    service = AuthService(db)
    try:
        user = await service.register(
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            organization_id=body.organization_id,
        )
        return UserPublic.model_validate(user)
    except ConflictError:
        # Email already exists. Responding 201 with a synthetic profile
        # keeps "address taken" indistinguishable from success, so the
        # endpoint cannot be used to enumerate registered accounts
        # (genuine entries are persisted; this payload is never stored).
        return UserPublic(
            id=uuid.uuid4(),
            email=str(body.email),
            full_name=body.full_name,
            status="active",
            is_platform_admin=False,
        )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Authenticate and issue tokens. Sets HttpOnly refresh-token cookie."""
    service = AuthService(db)
    access_token, refresh_token, user = await service.login(
        email=body.email,
        password=body.password,
        organization_id=body.organization_id,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )

    # Set refresh token as a secure, HttpOnly cookie
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
    )

    # Access token also set as cookie (avoids localStorage)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/logout", status_code=204, response_model=None)
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Revoke the refresh token and clear cookies."""
    refresh_token = request.cookies.get("refresh_token", "")
    if refresh_token:
        service = AuthService(db)
        await service.logout(refresh_token)

    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/api/v1/auth")


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Issue a new access token using the refresh token cookie."""
    refresh_token = request.cookies.get("refresh_token", "")
    if not refresh_token:
        # Fallback: check body (for non-browser clients). Cap the body so an
        # unauthenticated client cannot make the server parse arbitrarily
        # large payloads, and validate the shape strictly.
        body_bytes = await request.body()
        if len(body_bytes) > _MAX_REFRESH_BODY_BYTES:
            raise ValidationError("Request body too large.")
        try:
            body_data = json.loads(body_bytes)
            if not isinstance(body_data, dict):
                refresh_token = ""
            else:
                token_value = body_data.get("refresh_token", "")
                refresh_token = token_value if isinstance(token_value, str) else ""
        except Exception:
            refresh_token = ""

    service = AuthService(db)
    new_access, new_refresh = await service.refresh(refresh_token)

    response.set_cookie(
        key="refresh_token",
        value=new_refresh,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 86400,
        path="/api/v1/auth",
    )
    response.set_cookie(
        key="access_token",
        value=new_access,
        httponly=True,
        secure=settings.is_production,
        samesite="strict",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )

    return TokenResponse(
        access_token=new_access,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
    )


@router.post("/password-reset/initiate", status_code=204, response_model=None)
async def initiate_password_reset(
    body: PasswordResetInitRequest,
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Initiate password reset. Always returns 204 to prevent email enumeration.
    In production, send the token via email.
    """
    service = AuthService(db)
    token = await service.initiate_password_reset(email=body.email)
    if token:
        # TODO: send email with reset link containing the token
        # For development: log the token (never do this in production!)
        from app.core.logging import get_logger
        logger = get_logger(__name__)
        if settings.debug:
            logger.warning("dev_password_reset_token", token=token)


@router.post("/password-reset/complete", status_code=204, response_model=None)
async def complete_password_reset(
    body: PasswordResetCompleteRequest,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Complete password reset with token and new password."""
    service = AuthService(db)
    await service.complete_password_reset(
        token=body.token,
        new_password=body.new_password,
    )


@router.get("/me", response_model=UserPublic)
async def get_me(ctx: CurrentUser) -> UserPublic:
    """Return the authenticated user's profile."""
    user, org_id, role = ctx
    return UserPublic.model_validate(user).model_copy(
        update={"organization_role": role}
    )
