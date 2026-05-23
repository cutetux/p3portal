# p3portal.org
import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from backend import __version__
from backend.core.config import settings
from backend.core.deps import CurrentUser, require_admin
from backend.core.license import (
    CORE_MAX_GROUPS,
    CORE_MAX_OWNERSHIPS,
    CORE_MAX_PRESETS,
    CORE_MAX_SCHEDULED_JOBS_PER_USER,
    CORE_MAX_SIDEBAR_PINS,
    CORE_MAX_USERS,
    PLUS_HARD_MAX_PINS,
    PLUS_SOFT_WARN_PINS,
    get_license_status,
    is_plus_edition,
    reset_license_cache,
)
from backend.features.groups.service import count_groups
from backend.features.owners.service import count_active_ownerships_globally
from backend.services.local_auth import count_all_users
from backend.services.rbac_service import count_presets

_DISABLED_SUFFIX = ".disabled"

router = APIRouter(prefix="/api/license", tags=["license"])


@router.get("/status")
async def license_status():
    """Public endpoint: edition, validity, limits. contact_email intentionally omitted."""
    plus = is_plus_edition()
    current_users = await count_all_users()
    current_presets = await count_presets()
    current_groups = await count_groups()
    current_ownerships = await count_active_ownerships_globally()

    limits = {
        "users": {
            "current":   current_users,
            "max":       None if plus else CORE_MAX_USERS,
            "unlimited": plus,
        },
        "presets": {
            "current":   current_presets,
            "max":       None if plus else CORE_MAX_PRESETS,
            "unlimited": plus,
        },
        "groups": {
            "current":   current_groups,
            "max":       None if plus else CORE_MAX_GROUPS,
            "unlimited": plus,
        },
        "ownerships": {
            "current":   current_ownerships,
            "max":       None if plus else CORE_MAX_OWNERSHIPS,
            "unlimited": plus,
        },
        "sidebar_pins": {
            "max":       PLUS_HARD_MAX_PINS if plus else CORE_MAX_SIDEBAR_PINS,
            "soft_warn": PLUS_SOFT_WARN_PINS if plus else CORE_MAX_SIDEBAR_PINS,
            "hard_max":  PLUS_HARD_MAX_PINS,
        },
        "scheduled_jobs_per_user": {
            "max":       None if plus else CORE_MAX_SCHEDULED_JOBS_PER_USER,
            "unlimited": plus,
        },
    }

    s = get_license_status()
    return {
        "app_version":   __version__,
        "edition":       s.edition,
        "valid":         s.valid,
        "contact_name":  s.contact_name,
        "expiry":        s.expiry,
        "reason":        s.reason,
        "limits":        limits,
    }


@router.get("/details")
async def license_details(_: CurrentUser = Depends(require_admin)):
    """Admin-only: full license info including contact_email."""
    s = get_license_status()
    return {
        "edition":       s.edition,
        "valid":         s.valid,
        "contact_name":  s.contact_name,
        "contact_email": s.contact_email,
        "expiry":        s.expiry,
        "reason":        s.reason,
    }


@router.post("/upload")
async def upload_license(
    file: UploadFile = File(...),
    _: CurrentUser = Depends(require_admin),
):
    """Admin-only: Upload a new plus.lic file, persist it to the data directory and reload the cache."""
    content = await file.read()

    try:
        lic = json.loads(content)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="License file must be valid JSON")

    if not isinstance(lic, dict) or "license_id" not in lic or "key" not in lic:
        raise HTTPException(status_code=422, detail="Invalid license file: missing required fields")

    lic_path = Path(settings.plus_license_path)
    lic_path.parent.mkdir(parents=True, exist_ok=True)
    lic_path.write_bytes(content)

    reset_license_cache()
    s = get_license_status()

    return {
        "edition":       s.edition,
        "valid":         s.valid,
        "contact_name":  s.contact_name,
        "contact_email": s.contact_email,
        "expiry":        s.expiry,
        "reason":        s.reason,
    }


@router.delete("/deactivate")
async def deactivate_license(_: CurrentUser = Depends(require_admin)):
    """Admin-only: Rename plus.lic → plus.lic.disabled and reset to Core edition."""
    lic_path = Path(settings.plus_license_path)
    if not lic_path.exists():
        raise HTTPException(status_code=404, detail="No active license file found")

    disabled_path = lic_path.with_suffix(lic_path.suffix + _DISABLED_SUFFIX)
    # Remove old .disabled backup if present so rename always succeeds
    if disabled_path.exists():
        disabled_path.unlink()
    lic_path.rename(disabled_path)

    reset_license_cache()
    s = get_license_status()

    return {
        "edition": s.edition,
        "valid":   s.valid,
        "reason":  s.reason,
    }
