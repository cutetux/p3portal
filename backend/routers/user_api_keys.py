# p3portal.org
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, field_validator

from backend.core.deps import CurrentUser, get_current_user
from backend.core.plus_protocol import plus_behavior
from backend.services.local_auth import get_user_by_username
from backend.services.user_api_key_service import (
    EXPIRY_DAYS_OPTIONS,
    VALID_SCOPES,
    count_active_user_keys,
    create_user_key,
    list_user_keys,
    revoke_user_key,
)

router = APIRouter(prefix="/api/profile/api-keys", tags=["user-api-keys"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class UserApiKeyCreateRequest(BaseModel):
    name: str
    scopes: list[str]
    expires_in_days: int | None = 365  # None = no expiry (permanent)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name must not be empty")
        if len(v) > 100:
            raise ValueError("Name must not exceed 100 characters")
        return v

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: list[str]) -> list[str]:
        invalid = set(v) - VALID_SCOPES
        if invalid:
            raise ValueError(f"Unknown scopes: {sorted(invalid)}")
        if not v:
            raise ValueError("At least one scope required")
        return v

    @field_validator("expires_in_days")
    @classmethod
    def validate_expiry(cls, v: int | None) -> int | None:
        if v is not None and v not in EXPIRY_DAYS_OPTIONS:
            raise ValueError(
                f"expires_in_days must be one of {sorted(EXPIRY_DAYS_OPTIONS)} or null"
            )
        return v


class UserApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list[str]
    expires_at: str | None
    last_used_at: str | None
    is_active: bool
    created_at: str


class UserApiKeyCreateResponse(UserApiKeyResponse):
    plaintext_key: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_response(key) -> UserApiKeyResponse:
    return UserApiKeyResponse(
        id=key.id,
        name=key.name,
        key_prefix=key.key_prefix,
        scopes=key.scopes,
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        is_active=key.is_active,
        created_at=key.created_at,
    )


def _get_max_keys(user: dict) -> int:
    return plus_behavior.get_max_api_keys(user)


async def _require_keys_enabled(username: str) -> dict:
    """Load the local_users row and check api_keys_enabled. Raises 403 otherwise."""
    user = await get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User not found")
    if not user.get("api_keys_enabled"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API Keys sind für diesen Account nicht aktiviert",
        )
    return user


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[UserApiKeyResponse])
async def list_my_api_keys(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[UserApiKeyResponse]:
    user = await _require_keys_enabled(current_user.username)
    keys = await list_user_keys(user["id"])
    return [_to_response(k) for k in keys]


@router.post("", response_model=UserApiKeyCreateResponse, status_code=201)
async def create_my_api_key(
    body: UserApiKeyCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> UserApiKeyCreateResponse:
    user = await _require_keys_enabled(current_user.username)
    user_id: int = user["id"]

    # Key-limit check (edition-aware)
    max_keys = _get_max_keys(user)
    active_count = await count_active_user_keys(user_id)
    if active_count >= max_keys:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Maximale Key-Anzahl ({max_keys}) erreicht",
        )

    # Resolve admin-restricted scopes for this user
    allowed_scopes: list[str] | None = None
    raw = user.get("api_keys_allowed_scopes")
    if raw:
        try:
            allowed_scopes = json.loads(raw)
        except Exception:
            allowed_scopes = None

    try:
        key, plaintext = await create_user_key(
            user_id=user_id,
            name=body.name,
            scopes=body.scopes,
            expires_in_days=body.expires_in_days,
            allowed_scopes=allowed_scopes,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return UserApiKeyCreateResponse(
        **_to_response(key).model_dump(),
        plaintext_key=plaintext,
    )


@router.delete("/{key_id}", status_code=204)
async def revoke_my_api_key(
    key_id: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    user = await get_user_by_username(current_user.username)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    revoked = await revoke_user_key(key_id, user["id"])
    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API-Key nicht gefunden oder bereits widerrufen",
        )
    return Response(status_code=204)
