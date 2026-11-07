"""Schemas for organization user management (admin API)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, model_validator

AdminRole = Literal["admin", "member"]


class AdminUserOut(BaseModel):
    """A user as seen by an organization admin. Never includes credentials."""

    id: uuid.UUID
    email: str
    full_name: str
    role: AdminRole
    is_active: bool
    account_status: str
    is_platform_admin: bool
    joined_at: datetime
    is_self: bool


class AdminUserListResponse(BaseModel):
    items: list[AdminUserOut]
    total: int
    page: int
    page_size: int


class AdminUserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: AdminRole = "member"


class AdminUserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: AdminRole | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_at_least_one_field(self) -> AdminUserUpdate:
        if self.full_name is None and self.role is None and self.is_active is None:
            raise ValueError("At least one field must be provided.")
        return self


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)
