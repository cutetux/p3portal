# p3portal.org
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.core.plus_protocol import plus_behavior
from backend.models.i18n import LanguageResponse, SetDefaultLangRequest
from backend.services import i18n_service
from backend.services.settings_service import get_setting, set_setting

router = APIRouter(prefix="/api/i18n", tags=["i18n"])

_SETTING_KEY = "i18n.global_default_lang"
_DEFAULT_LANG = "de"


# ── Public ────────────────────────────────────────────────────────────────────

@router.get("/default")
async def get_global_default_lang() -> dict:
    lang = await get_setting(_SETTING_KEY) or _DEFAULT_LANG
    return {"lang_code": lang}


# ── Authenticated – must be declared BEFORE /{lang_code} to avoid route shadowing ──

@router.get("/languages", response_model=list[LanguageResponse])
async def list_languages(
    _: CurrentUser = Depends(get_current_user),
) -> list[LanguageResponse]:
    return [LanguageResponse(**l) for l in i18n_service.list_languages()]


@router.post("/default", status_code=204)
async def set_global_default_lang(
    body: SetDefaultLangRequest,
    admin: CurrentUser = Depends(require_admin),
) -> Response:
    await set_setting(_SETTING_KEY, body.lang_code, admin.username)
    return Response(status_code=204)


@router.post("/upload", response_model=LanguageResponse, status_code=201)
async def upload_language(
    file: UploadFile,
    admin: CurrentUser = Depends(require_admin),
) -> LanguageResponse:
    if not plus_behavior.can_change_language():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Plus-Lizenz erforderlich")

    content = await file.read()
    if len(content) > i18n_service.MAX_LANG_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu groß (max. 500 KB)")

    filename = file.filename or "unknown.yml"
    try:
        result = i18n_service.upload_translation(filename, content, admin.username)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return LanguageResponse(**result)


@router.delete("/{lang_code}", status_code=204)
async def delete_language(
    lang_code: str,
    _: CurrentUser = Depends(require_admin),
) -> Response:
    try:
        found = i18n_service.delete_translation(lang_code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not found:
        raise HTTPException(status_code=404, detail=f"Sprache '{lang_code}' nicht gefunden")
    return Response(status_code=204)


# ── Public: /{lang_code} – LAST because it's a catch-all parameterized route ──

@router.get("/{lang_code}")
async def get_translation(lang_code: str) -> dict:
    """Returns the translation JSON for the given language code. No auth required."""
    data = i18n_service.get_translation(lang_code)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Sprache '{lang_code}' nicht gefunden")
    return data
