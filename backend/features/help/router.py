# p3portal.org
"""PROJ-57: FastAPI-Router für das P3-Handbuch (Help-Override-System).

7 Endpoints:
  GET  /api/help/overrides/me          – eigene User-Overrides (für Resolver + MyAccount-Tab)
  GET  /api/help/overrides/global      – alle globalen Overrides (für Resolver)
  POST /api/help/overrides             – eigenen Override hochladen (Multipart)
  DELETE /api/help/overrides/{id}      – eigenen löschen / Admin moderiert fremden
  POST /api/help/overrides/{id}/promote – User-Override → global (manage_help + Plus)
  DELETE /api/help/global/{key}/{lang} – globalen Override entfernen (manage_help)
  GET  /api/help/admin/overrides       – alle Overrides für Admin-Tab (manage_help)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.core.plus_protocol import plus_behavior
from . import service
from .sanitizer import validate_and_sanitize
from .schemas import (
    HelpAdminOverrideResponse,
    HelpDeleteResponse,
    HelpMyOverrideResponse,
    HelpOverrideResponse,
    HelpPromoteResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/help", tags=["help"])

_require_manage_help = require_admin_or("manage_help")


def _is_help_manager(user: CurrentUser) -> bool:
    return user.role == "admin" or "manage_help" in user.portal_permissions


# ── 1. GET /api/help/overrides/me ────────────────────────────────────────────

@router.get("/overrides/me", response_model=list[HelpOverrideResponse])
async def get_my_overrides(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Gibt alle persönlichen Help-Overrides des eingeloggten Users zurück.

    Wird vom Frontend-Resolver und vom MyAccount-Tab 'Meine Hilfetexte' genutzt.
    """
    if current_user.user_id is None:
        return []
    return await service.list_user_overrides(current_user.user_id)


# ── 2. GET /api/help/overrides/global ────────────────────────────────────────

@router.get("/overrides/global", response_model=list[HelpOverrideResponse])
async def get_global_overrides(
    _: CurrentUser = Depends(get_current_user),
):
    """Gibt alle aktiven globalen Overrides zurück.

    Wird vom Frontend-Resolver beim ersten Slide-Over-Open geladen (Bulk-Fetch).
    """
    return await service.list_global_overrides()


# ── 3. POST /api/help/overrides ───────────────────────────────────────────────

@router.post("/overrides", response_model=HelpOverrideResponse, status_code=status.HTTP_201_CREATED)
async def upload_override(
    request: Request,
    key: str = Form(...),
    lang: str = Form(...),
    consent: str = Form(...),   # "true" bei Pflicht-Checkbox (AC-UPLOAD-10)
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Lädt eine eigene .md-Datei für einen Hilfeeintrag hoch.

    Validierung:
    - key: muss nicht-leer sein (Registry-Prüfung erfolgt client-seitig)
    - lang: "de" oder "en"
    - consent: muss "true" sein (Pflicht-Checkbox AC-UPLOAD-10)
    - file: max. 200 KB, .md/.markdown, UTF-8
    """
    # Proxmox-User haben keine user_id → kein Upload möglich
    if current_user.user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Help-Uploads sind nur für lokale Portal-Nutzer verfügbar.",
        )

    # Pflicht-Einwilligung (AC-UPLOAD-10)
    if consent.strip().lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Einwilligung zur möglichen Globalisierung ist erforderlich.",
        )

    # Sprach-Validierung
    if lang not in ("de", "en"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ungültige Sprache. Erlaubt: de, en.",
        )

    # Schlüssel-Validierung
    if not key or not key.replace(".", "_").replace("-", "_").isidentifier():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ungültiger Hilfe-Schlüssel.",
        )

    # Datei lesen & sanitisieren
    content_bytes = await file.read()
    try:
        content = validate_and_sanitize(content_bytes, filename=file.filename or "")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    ip = request.client.host if request.client else None

    try:
        record = await service.upload_user_override(
            user_id=current_user.user_id,
            username=current_user.username,
            key=key,
            lang=lang,
            content=content,
            ip_address=ip,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail=str(exc),
        )

    return record


# ── 4. DELETE /api/help/overrides/{id} ───────────────────────────────────────

@router.delete("/overrides/{override_id}", response_model=HelpDeleteResponse)
async def delete_override(
    override_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Löscht einen Help-Override.

    Owner kann seinen eigenen löschen.
    Admin (manage_help) kann jeden User-Override moderieren.
    Globale Overrides → DELETE /api/help/global/{key}/{lang} nutzen.
    """
    if current_user.user_id is None and not _is_help_manager(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Kein Zugriff.",
        )

    ip = request.client.host if request.client else None

    try:
        rec = await service.delete_override(
            override_id=override_id,
            current_user_id=current_user.user_id or -1,
            current_username=current_user.username,
            is_admin=_is_help_manager(current_user),
            ip_address=ip,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))

    return HelpDeleteResponse(
        deleted_id=override_id,
        message=f"Override für key='{rec['key']}', lang='{rec['lang']}' gelöscht.",
    )


# ── 5. POST /api/help/overrides/{id}/promote ─────────────────────────────────

@router.post("/overrides/{override_id}/promote", response_model=HelpPromoteResponse)
async def promote_override(
    override_id: int,
    request: Request,
    current_user: CurrentUser = Depends(_require_manage_help),
):
    """Promotet einen User-Override zum globalen Override (Plus-only, manage_help).

    Bei inaktiver Plus-Lizenz: HTTP 412.
    """
    # Plus-Gate: CORE_MAX_HELP_GLOBAL_OVERRIDES = 0 → Plus-only
    max_global = plus_behavior.get_max_help_global_overrides()
    if max_global is not None and max_global == 0:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail=(
                "Globale Hilfe-Overrides sind Plus-only. "
                "Bitte Plus-Lizenz aktivieren."
            ),
        )

    ip = request.client.host if request.client else None

    try:
        record = await service.promote_to_global(
            override_id=override_id,
            admin_user_id=current_user.user_id or 0,
            admin_username=current_user.username,
            ip_address=ip,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))

    return HelpPromoteResponse(
        global_override_id=record["id"],
        key=record["key"],
        lang=record["lang"],
        content_md5=record["content_md5"],
    )


# ── 6. DELETE /api/help/global/{key}/{lang} ───────────────────────────────────

@router.delete("/global/{key}/{lang}", response_model=HelpDeleteResponse)
async def remove_global_override(
    key: str,
    lang: str,
    request: Request,
    current_user: CurrentUser = Depends(_require_manage_help),
):
    """Entfernt einen globalen Override (Repo-Default greift wieder).

    Erfordert manage_help.
    """
    if lang not in ("de", "en"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ungültige Sprache. Erlaubt: de, en.",
        )

    ip = request.client.host if request.client else None

    try:
        result = await service.remove_global_override(
            key=key,
            lang=lang,
            admin_username=current_user.username,
            ip_address=ip,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))

    return HelpDeleteResponse(
        deleted_id=result["deleted_id"],
        message=f"Globaler Override für key='{key}', lang='{lang}' entfernt.",
    )


# ── 7. GET /api/help/admin/overrides ─────────────────────────────────────────

@router.get("/admin/overrides", response_model=list[HelpAdminOverrideResponse])
async def admin_list_overrides(
    _: CurrentUser = Depends(_require_manage_help),
):
    """Gibt alle Overrides (user + global) für den Admin-Tab zurück.

    Enthält Uploader-Usernamen und content_md5 für Repo-Vergleich.
    """
    return await service.list_all_overrides_admin()
