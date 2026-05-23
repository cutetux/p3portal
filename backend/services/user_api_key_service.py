# p3portal.org
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from backend.db.database import get_db

VALID_SCOPES: frozenset[str] = frozenset({
    "cluster:read",
    "jobs:read",
    "jobs:write",
    "playbooks:read",
    "playbooks:write",   # PROJ-44
    "packer:read",
    "packer:write",
    "groups:read",       # PROJ-45
    "groups:write",      # PROJ-45
    "pools:read",        # PROJ-46
    "pools:write",       # PROJ-46
    "pools:deploy",      # PROJ-46
    "owners:read",       # PROJ-44 / PROJ-48
    "approvals:read",    # PROJ-44 / PROJ-50
    "approvals:approve", # PROJ-44 / PROJ-50
})

KEY_PREFIX = "upk_"
KEY_RANDOM_BYTES = 32  # 64 hex chars = 256 bits entropy
CORE_MAX_KEYS = 1
DEFAULT_PLUS_MAX_KEYS = 5
EXPIRY_DAYS_OPTIONS: frozenset[int] = frozenset({30, 90, 180, 365})


@dataclass
class UserApiKeyRow:
    id: int
    user_id: int
    name: str
    key_prefix: str
    scopes: list[str]
    expires_at: str | None
    last_used_at: str | None
    is_active: bool
    created_at: str


def _generate_key() -> tuple[str, str, str]:
    """Return (plaintext, sha256_hash, display_prefix)."""
    random_hex = os.urandom(KEY_RANDOM_BYTES).hex()
    plaintext = f"{KEY_PREFIX}{random_hex}"
    key_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    display_prefix = plaintext[:12]  # "upk_" + 8 chars
    return plaintext, key_hash, display_prefix


def _hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode()).hexdigest()


def _row_to_key(row) -> UserApiKeyRow:
    return UserApiKeyRow(
        id=row["id"],
        user_id=row["user_id"],
        name=row["name"],
        key_prefix=row["key_prefix"],
        scopes=json.loads(row["scopes"]),
        expires_at=row["expires_at"],
        last_used_at=row["last_used_at"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
    )


async def list_user_keys(user_id: int) -> list[UserApiKeyRow]:
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT * FROM user_api_keys WHERE user_id = :uid "
                "ORDER BY created_at DESC"
            ),
            {"uid": user_id},
        )
        rows = result.mappings().fetchall()
    return [_row_to_key(r) for r in rows]


async def count_active_user_keys(user_id: int) -> int:
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM user_api_keys "
                "WHERE user_id = :uid AND is_active = 1"
            ),
            {"uid": user_id},
        )
        return result.scalar() or 0


async def create_user_key(
    user_id: int,
    name: str,
    scopes: list[str],
    expires_in_days: int | None,
    allowed_scopes: list[str] | None,
) -> tuple[UserApiKeyRow, str]:
    """Create a new User API Key. Returns (row, plaintext_key).

    Raises ValueError if scopes exceed allowed_scopes.
    Key-limit enforcement must be done by the caller before calling this.
    """
    invalid = set(scopes) - VALID_SCOPES
    if invalid:
        raise ValueError(f"Unknown scopes: {sorted(invalid)}")
    if not scopes:
        raise ValueError("At least one scope required")

    if allowed_scopes is not None:
        forbidden = set(scopes) - set(allowed_scopes)
        if forbidden:
            raise ValueError(f"Scopes not allowed by admin: {sorted(forbidden)}")

    plaintext, key_hash, display_prefix = _generate_key()
    now = datetime.now(timezone.utc).isoformat()

    expires_at: str | None = None
    if expires_in_days is not None:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(days=expires_in_days)
        ).isoformat()

    async with get_db() as session:
        await session.execute(
            text(
                "INSERT INTO user_api_keys "
                "(user_id, name, key_hash, key_prefix, scopes, expires_at, is_active, created_at) "
                "VALUES (:uid, :name, :hash, :prefix, :scopes, :exp, 1, :now)"
            ),
            {
                "uid": user_id,
                "name": name,
                "hash": key_hash,
                "prefix": display_prefix,
                "scopes": json.dumps(sorted(scopes)),
                "exp": expires_at,
                "now": now,
            },
        )
        await session.commit()
        result = await session.execute(
            text("SELECT * FROM user_api_keys WHERE key_hash = :h"), {"h": key_hash}
        )
        row = result.mappings().fetchone()

    return _row_to_key(row), plaintext


async def revoke_user_key(key_id: int, user_id: int) -> bool:
    """Revoke a specific key belonging to user_id. Returns True if revoked."""
    async with get_db() as session:
        res = await session.execute(
            text(
                "UPDATE user_api_keys SET is_active = 0 "
                "WHERE id = :id AND user_id = :uid AND is_active = 1"
            ),
            {"id": key_id, "uid": user_id},
        )
        await session.commit()
    return res.rowcount > 0


async def revoke_all_user_keys(user_id: int) -> int:
    """Deactivate all active keys for a user. Called when admin disables api_keys_enabled."""
    async with get_db() as session:
        res = await session.execute(
            text(
                "UPDATE user_api_keys SET is_active = 0 "
                "WHERE user_id = :uid AND is_active = 1"
            ),
            {"uid": user_id},
        )
        await session.commit()
    return res.rowcount


async def authenticate_user_key(plaintext: str) -> dict | None:
    """Authenticate a User API Key. Returns info dict on success or None if key not found.

    Raises ValueError with a human-readable reason when the key exists but is invalid
    (revoked, expired, user disabled, or admin access revoked).
    """
    key_hash = _hash_key(plaintext)
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT k.id AS key_id, k.user_id, k.scopes, k.is_active, k.expires_at, "
                "u.username, u.role, u.active AS user_active, u.api_keys_enabled "
                "FROM user_api_keys k "
                "JOIN local_users u ON k.user_id = u.id "
                "WHERE k.key_hash = :h"
            ),
            {"h": key_hash},
        )
        row = result.mappings().fetchone()

    if row is None:
        return None

    if not row["is_active"]:
        raise ValueError("API key revoked or deactivated")

    now_iso = datetime.now(timezone.utc).isoformat()
    if row["expires_at"] and row["expires_at"] < now_iso:
        raise ValueError("API key expired")

    if not row["user_active"]:
        raise ValueError("User account disabled")

    if not row["api_keys_enabled"]:
        raise ValueError("API keys disabled for this user")

    return {
        "key_id": row["key_id"],
        "user_id": row["user_id"],
        "username": row["username"],
        "role": row["role"],
        "scopes": json.loads(row["scopes"]),
    }


async def touch_last_used(key_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        await session.execute(
            text("UPDATE user_api_keys SET last_used_at = :now WHERE id = :id"),
            {"now": now, "id": key_id},
        )
        await session.commit()


async def get_user_api_key_settings(user_id: int) -> dict | None:
    """Return admin-configurable API-key settings for a user. None if user not found."""
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT api_keys_enabled, api_keys_allowed_scopes, api_keys_max_count "
                "FROM local_users WHERE id = :id"
            ),
            {"id": user_id},
        )
        row = result.mappings().fetchone()

    if row is None:
        return None

    allowed: list[str] | None = None
    raw = row["api_keys_allowed_scopes"]
    if raw:
        try:
            allowed = json.loads(raw)
        except Exception:
            allowed = None

    return {
        "api_keys_enabled": bool(row["api_keys_enabled"]),
        "api_keys_allowed_scopes": allowed,
        "api_keys_max_count": row["api_keys_max_count"],
    }


async def update_user_api_key_settings(
    user_id: int,
    enabled: bool,
    allowed_scopes: list[str] | None,
    max_count: int | None,
) -> bool:
    """Update admin-configurable API-key settings.

    If disabling (enabled=False), all active keys for that user are deactivated
    immediately. Returns False if user not found.
    """
    async with get_db() as session:
        check = await session.execute(
            text("SELECT id, api_keys_enabled FROM local_users WHERE id = :id"),
            {"id": user_id},
        )
        row = check.mappings().fetchone()
        if row is None:
            return False

        was_enabled = bool(row["api_keys_enabled"])
        scopes_json = (
            json.dumps(sorted(allowed_scopes)) if allowed_scopes is not None else None
        )

        await session.execute(
            text(
                "UPDATE local_users SET "
                "api_keys_enabled = :enabled, "
                "api_keys_allowed_scopes = :scopes, "
                "api_keys_max_count = :max_count "
                "WHERE id = :id"
            ),
            {
                "enabled": 1 if enabled else 0,
                "scopes": scopes_json,
                "max_count": max_count,
                "id": user_id,
            },
        )

        if was_enabled and not enabled:
            await session.execute(
                text(
                    "UPDATE user_api_keys SET is_active = 0 "
                    "WHERE user_id = :uid AND is_active = 1"
                ),
                {"uid": user_id},
            )

        await session.commit()
    return True
