# p3portal.org
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import text

from backend.core.deps import CurrentUser, get_current_user, require_admin, require_not_restricted
from backend.features.api_surface.deps import require_scope_for_upk
from backend.db.database import get_db
from backend.models.playbooks import PlaybookDetail, PlaybookSummary
from backend.services.playbook_service import delete_playbook, get_playbook, get_playbook_description, list_playbooks, save_playbook_zip

router = APIRouter(prefix="/api/playbooks", tags=["playbooks"])


@router.get("", response_model=list[PlaybookSummary])
async def get_playbooks(
    current_user: CurrentUser = Depends(require_not_restricted),
    _scope: CurrentUser = Depends(require_scope_for_upk("playbooks:read")),
) -> list[PlaybookSummary]:
    import asyncio
    from backend.services.playbook_service import _load_all_metas

    # PROJ-63: can_execute via Bulk-Hook (1 SQL-Query statt N+1)
    playbooks = list_playbooks()
    if current_user.user_id is None:
        return playbooks
    try:
        from backend.core.plus_protocol import plus_behavior, PlaybookPermissionDecision
        from backend.services.permissions_resolver import _is_admin
        from backend.db.database import get_db as _get_db

        async with _get_db() as _db:
            is_admin = await _is_admin(_db, current_user.user_id)

        if is_admin:
            for pb in playbooks:
                pb.can_execute = True
        else:
            pb_names = [pb.id for pb in playbooks]
            decision_map = await plus_behavior.get_playbook_can_execute_map(
                current_user.user_id, pb_names
            )
            from backend.services.permissions_resolver import can_user_execute_playbook
            for pb in playbooks:
                decision = decision_map.get(pb.id, PlaybookPermissionDecision.FALLBACK)
                if decision == PlaybookPermissionDecision.ALLOW:
                    pb.can_execute = True
                elif decision == PlaybookPermissionDecision.DENY:
                    pb.can_execute = False
                else:
                    # FALLBACK: required_role-Check (Core-Standard)
                    pb.can_execute = await can_user_execute_playbook(current_user.user_id, pb.id)
    except Exception:
        pass  # Resolver-Fehler darf die Liste nicht blockieren

    # PROJ-50: Discovery-Sync (fire-and-forget, blockiert nie die Response)
    asyncio.ensure_future(_sync_playbook_approval_rules(_load_all_metas()))

    # PROJ-63 AC-CORE-HOOK-9: Stale Whitelist-Einträge entfernen (fire-and-forget)
    try:
        from backend.core.plus_protocol import plus_behavior as _pb
        _known = {pb.id for pb in playbooks}
        asyncio.ensure_future(_pb.cleanup_stale_playbook_permissions(_known))
    except Exception:
        pass

    return playbooks


async def _sync_playbook_approval_rules(metas) -> None:
    try:
        from backend.core.plus_protocol import plus_behavior as _pb
        for pid, meta in metas:
            await _pb.sync_meta_yaml_approval_rule(
                "playbook_run", pid, meta.approval if meta.approval else None
            )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).debug("PROJ-64 playbook approval sync error: %s", exc)


@router.get("/{playbook_id}/description")
async def get_playbook_description_endpoint(
    playbook_id: str,
    _: str = Depends(get_current_user),
) -> dict:
    """Read description.md from the playbook directory."""
    return {"content": get_playbook_description(playbook_id)}


@router.get("/{playbook_id}", response_model=PlaybookDetail)
async def get_playbook_detail(
    playbook_id: str,
    _: str = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("playbooks:read")),
) -> PlaybookDetail:
    detail = get_playbook(playbook_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playbook not found")
    return detail


@router.post("/upload", response_model=PlaybookSummary, status_code=201)
async def upload_playbook(
    zip_file: UploadFile = File(...),
    _: CurrentUser = Depends(require_admin),
    _scope: CurrentUser = Depends(require_scope_for_upk("playbooks:write")),
) -> PlaybookSummary:
    if not (zip_file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="Nur ZIP-Archive werden akzeptiert (.zip)")
    zip_content = await zip_file.read()
    try:
        playbook_id = save_playbook_zip(zip_content)
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Fehler beim Schreiben: {exc}")
    detail = get_playbook(playbook_id)
    return PlaybookSummary(
        id=playbook_id,
        name=detail.name if detail else playbook_id,
        description=detail.description if detail else "",
        required_role=detail.required_role if detail else None,
        category=detail.category if detail else None,
    )


@router.delete("/{playbook_id}", status_code=204)
async def delete_playbook_endpoint(
    playbook_id: str,
    current_user: CurrentUser = Depends(require_admin),
    _scope: CurrentUser = Depends(require_scope_for_upk("playbooks:write")),
) -> Response:
    if get_playbook(playbook_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playbook not found")

    async with get_db() as session:
        result = await session.execute(
            text("SELECT id FROM jobs WHERE type='ansible' AND playbook=:pid AND status='running'"),
            {"pid": playbook_id},
        )
        if result.mappings().fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Playbook kann nicht gelöscht werden, da ein Job läuft",
            )

    if not delete_playbook(playbook_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playbook nicht gefunden")

    # PROJ-63: Whitelist-Einträge für dieses Playbook entfernen (Plus-Protocol-Hook)
    try:
        from backend.core.plus_protocol import plus_behavior
        await plus_behavior.on_playbook_deleted_playbook_permissions(playbook_id, current_user.username)
    except Exception:
        pass

    # PROJ-64: Pending Approvals für dieses Playbook canceln (Plus-Protocol-Hook)
    try:
        from backend.core.plus_protocol import plus_behavior
        await plus_behavior.on_playbook_deleted_approval_workflow(playbook_id, current_user.username)
    except Exception:
        pass

    # PROJ-70: Scheduled-Jobs für dieses Playbook deaktivieren (Plus-Protocol-Hook)
    try:
        from backend.core.plus_protocol import plus_behavior
        await plus_behavior.on_playbook_deleted_scheduled_jobs(playbook_id, current_user.username)
    except Exception:
        pass

    return Response(status_code=204)
