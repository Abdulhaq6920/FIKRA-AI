"""Schemas for health and readiness probe responses."""

from __future__ import annotations

from pydantic import BaseModel


class HealthLiveResponse(BaseModel):
    """Liveness payload — always minimal, never touches dependencies."""

    status: str = "ok"
    app: str


class HealthStatusResponse(BaseModel):
    """Shared health payload for readiness / startup checks."""

    status: str
    checks: dict[str, str] = {}
