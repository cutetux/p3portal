# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-68: Git-Sync Service – Konfiguration, SSH-Keypair, Sync-Logik, Konflikt-Management.

Nebenläufigkeit: Pro repo_type ein asyncio.Lock; max. 1 queued Trigger (AC-ERR-5).
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

# ── asyncio.Locks + Queue-Flags pro repo_type ─────────────────────────────────
_locks: dict[str, asyncio.Lock] = {
    "ansible": asyncio.Lock(),
    "packer": asyncio.Lock(),
}
_queued: dict[str, bool] = {
    "ansible": False,
    "packer": False,
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── SSH-Keypair-Generierung ────────────────────────────────────────────────────

def generate_ed25519_keypair() -> tuple[str, str]:
    """Generiert ein Ed25519-Keypair. Gibt (private_key_pem, public_key_openssh) zurück.

    Nutzt ausschließlich die bereits installierte `cryptography`-Bibliothek (PROJ-68 §G).
    private_key_pem: OpenSSH-PEM-Format (str)
    public_key_openssh: 'ssh-ed25519 AAAA...' (str)
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, NoEncryption, PrivateFormat, PublicFormat,
    )

    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=Encoding.PEM,
        format=PrivateFormat.OpenSSH,
        encryption_algorithm=NoEncryption(),
    ).decode("utf-8")
    public_openssh = private_key.public_key().public_bytes(
        encoding=Encoding.OpenSSH,
        format=PublicFormat.OpenSSH,
    ).decode("utf-8")
    return private_pem, public_openssh


def generate_webhook_token() -> str:
    """Generiert einen sicheren Webhook-Token (32 Bytes = 64 Hex-Zeichen)."""
    return secrets.token_hex(32)


# ── Config CRUD ───────────────────────────────────────────────────────────────

async def get_config(repo_type: str) -> dict | None:
    """Gibt die Config für einen repo_type zurück (Token-Felder entschlüsselt)."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_configs

    async with get_db() as db:
        rows = await db.execute(
            git_sync_configs.select().where(git_sync_configs.c.repo_type == repo_type)
        )
        row = rows.mappings().first()
        if row is None:
            return None
        return dict(row)


async def get_config_for_api(repo_type: str) -> dict:
    """Gibt Config für API-Response zurück (Token-Felder zensiert)."""
    from backend.services.config_service import decrypt_secret

    raw = await get_config(repo_type)
    if raw is None:
        return _empty_config_response(repo_type)

    return {
        "id": raw["id"],
        "repo_type": repo_type,
        "enabled": bool(raw["enabled"]),
        "repo_url": raw["repo_url"] or "",
        "branch": raw["branch"] or "main",
        "subdir": raw["subdir"],
        "auth_method": raw["auth_method"] or "https",
        "https_username": raw["https_username"],
        "has_https_token": bool(raw["https_token_enc"]),
        "ssh_public_key": raw["ssh_public_key"],
        "has_webhook_token": bool(raw["webhook_token_enc"]),
        "auto_sync_interval": raw["auto_sync_interval"] or 0,
        "updated_at": raw["updated_at"],
        "updated_by": raw["updated_by"],
    }


def _empty_config_response(repo_type: str) -> dict:
    return {
        "id": None,
        "repo_type": repo_type,
        "enabled": False,
        "repo_url": "",
        "branch": "main",
        "subdir": None,
        "auth_method": "https",
        "https_username": None,
        "has_https_token": False,
        "ssh_public_key": None,
        "has_webhook_token": False,
        "auto_sync_interval": 0,
        "updated_at": None,
        "updated_by": None,
    }


async def upsert_config(repo_type: str, data: dict, actor: str) -> dict:
    """Speichert oder aktualisiert die Config. Gibt die neue API-Response zurück.

    data-Felder: enabled, repo_url, branch, subdir, auth_method,
                 https_username, https_token (Klartext – wird verschlüsselt),
                 auto_sync_interval.
    SSH-Keys werden NICHT über diesen Pfad gesetzt (separater Endpoint).
    """
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_configs
    from backend.services.config_service import decrypt_secret, encrypt_secret

    existing = await get_config(repo_type)

    # HTTPS-Token: nur überschreiben wenn neuer Token übergeben wurde
    https_token_enc: str | None
    if data.get("https_token"):
        https_token_enc = encrypt_secret(data["https_token"])
    elif existing:
        https_token_enc = existing.get("https_token_enc")
    else:
        https_token_enc = None

    # Webhook-Token: auto-generieren falls noch keiner existiert
    if existing and existing.get("webhook_token_enc"):
        webhook_token_enc = existing["webhook_token_enc"]
    else:
        webhook_token_enc = encrypt_secret(generate_webhook_token())

    # Repo-URL-Wechsel: lokalen Clone löschen (Edge Case 4)
    if existing and existing.get("repo_url") and existing["repo_url"] != data.get("repo_url", existing["repo_url"]):
        _delete_clone_dir(repo_type)

    now = _now_iso()
    values = {
        "repo_type": repo_type,
        "enabled": 1 if data.get("enabled") else 0,
        "repo_url": data.get("repo_url", ""),
        "branch": data.get("branch", "main"),
        "subdir": data.get("subdir"),
        "auth_method": data.get("auth_method", "https"),
        "https_username": data.get("https_username"),
        "https_token_enc": https_token_enc,
        "webhook_token_enc": webhook_token_enc,
        "auto_sync_interval": data.get("auto_sync_interval", 0),
        "updated_at": now,
        "updated_by": actor,
    }

    async with get_db() as db:
        if existing:
            await db.execute(
                git_sync_configs.update()
                .where(git_sync_configs.c.repo_type == repo_type)
                .values(**values)
            )
        else:
            # SSH-Keys bleiben bei neuem Eintrag leer – separater Endpoint
            values["ssh_public_key"] = None
            values["ssh_private_key_enc"] = None
            await db.execute(git_sync_configs.insert().values(**values))
        await db.commit()

    result = await get_config_for_api(repo_type)
    # BUG-68-2: Scheduled Job bei Interval-Änderung anlegen/aktualisieren/deaktivieren
    await _sync_scheduled_job(repo_type, data.get("auto_sync_interval", 0), actor)
    return result


async def delete_config(repo_type: str) -> None:
    """Löscht Config + lokales Clone-Verzeichnis + deaktiviert Auto-Sync SJ."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_configs

    await _sync_scheduled_job(repo_type, 0, "system")
    _delete_clone_dir(repo_type)
    async with get_db() as db:
        await db.execute(
            git_sync_configs.delete().where(git_sync_configs.c.repo_type == repo_type)
        )
        await db.commit()


# ── Scheduled-Job-Sync (BUG-68-2) ────────────────────────────────────────────

_INTERVAL_TO_CRON: dict[int, str] = {
    5: "*/5 * * * *",
    15: "*/15 * * * *",
    30: "*/30 * * * *",
    60: "0 * * * *",
}


async def _sync_scheduled_job(repo_type: str, interval: int, actor: str) -> None:
    """Erstellt / aktualisiert / deaktiviert den Auto-Sync Scheduled Job.

    Wird nach upsert_config() und delete_config() aufgerufen.
    interval = 0  → SJ deaktivieren (falls vorhanden).
    interval > 0  → SJ anlegen oder Cron-Expression aktualisieren.
    """
    from backend.db.database import get_db
    from backend.plus.scheduled_jobs import service as sjs
    from sqlalchemy import text

    async with get_db() as db:
        row = (await db.execute(
            text(
                "SELECT id, cron_expression, active "
                "FROM scheduled_jobs "
                "WHERE job_type = 'git_sync' "
                "AND json_extract(config, '$.repo_type') = :rt"
            ),
            {"rt": repo_type},
        )).mappings().first()

    existing_id: str | None = row["id"] if row else None

    if interval > 0:
        cron = _INTERVAL_TO_CRON.get(interval, f"*/{interval} * * * *")
        if existing_id is None:
            await sjs.create_job(
                name=f"Git-Sync {repo_type.title()}",
                job_type="git_sync",
                cron_expression=cron,
                config={"repo_type": repo_type},
                created_by=actor,
                description=f"Automatischer Git-Sync für {repo_type}",
                active=True,
            )
        else:
            current_cron = row["cron_expression"] if row else None
            current_active = bool(row["active"]) if row else False
            if current_cron != cron or not current_active:
                await sjs.update_job(existing_id, cron_expression=cron, active=True)
    else:
        if existing_id is not None and bool(row["active"]):
            await sjs.update_job(existing_id, active=False)


def _delete_clone_dir(repo_type: str) -> None:
    clone_dir = _get_clone_dir(repo_type)
    if clone_dir.exists():
        try:
            shutil.rmtree(clone_dir)
            logger.info("Clone-Dir gelöscht: %s", clone_dir)
        except Exception as exc:
            logger.warning("Clone-Dir löschen fehlgeschlagen: %s", exc)


def _get_clone_dir(repo_type: str) -> Path:
    from backend.core.config import settings
    return Path(settings.data_dir) / "git_sync" / f"{repo_type}-clone"


def _get_target_dir(repo_type: str) -> Path:
    """Gibt das Zielverzeichnis zurück (ansible/ oder packer/)."""
    from backend.core.config import settings
    if repo_type == "ansible":
        return Path(settings.ansible_dir)
    else:
        return Path(settings.packer_dir)


# ── SSH-Keypair-Management ────────────────────────────────────────────────────

async def get_ssh_public_key(repo_type: str) -> str | None:
    raw = await get_config(repo_type)
    if raw is None:
        return None
    return raw.get("ssh_public_key")


async def regenerate_ssh_key(repo_type: str, actor: str) -> str:
    """Generiert ein neues Ed25519-Keypair, speichert es und gibt den Public-Key zurück."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_configs
    from backend.services.config_service import encrypt_secret

    private_pem, public_openssh = generate_ed25519_keypair()
    private_enc = encrypt_secret(private_pem)
    now = _now_iso()

    async with get_db() as db:
        existing = await get_config(repo_type)
        if existing:
            await db.execute(
                git_sync_configs.update()
                .where(git_sync_configs.c.repo_type == repo_type)
                .values(
                    ssh_public_key=public_openssh,
                    ssh_private_key_enc=private_enc,
                    updated_at=now,
                    updated_by=actor,
                )
            )
        else:
            # Erstes Mal – Eintrag anlegen mit Minimalwerten
            await db.execute(git_sync_configs.insert().values(
                repo_type=repo_type,
                enabled=0,
                repo_url="",
                branch="main",
                subdir=None,
                auth_method="ssh",
                https_username=None,
                https_token_enc=None,
                ssh_public_key=public_openssh,
                ssh_private_key_enc=private_enc,
                webhook_token_enc=encrypt_secret(generate_webhook_token()),
                auto_sync_interval=0,
                updated_at=now,
                updated_by=actor,
            ))
        await db.commit()

    return public_openssh


# ── Webhook-Token-Management ──────────────────────────────────────────────────

async def regenerate_webhook_token(repo_type: str, actor: str) -> str:
    """Generiert einen neuen Webhook-Token. Alter Token wird sofort ungültig."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_configs
    from backend.services.config_service import encrypt_secret

    new_token = generate_webhook_token()
    new_token_enc = encrypt_secret(new_token)
    now = _now_iso()

    async with get_db() as db:
        await db.execute(
            git_sync_configs.update()
            .where(git_sync_configs.c.repo_type == repo_type)
            .values(webhook_token_enc=new_token_enc, updated_at=now, updated_by=actor)
        )
        await db.commit()

    return new_token


async def verify_webhook_token(repo_type: str, token: str) -> bool:
    """Prüft ob der übergebene Token mit dem gespeicherten übereinstimmt."""
    from backend.services.config_service import decrypt_secret

    raw = await get_config(repo_type)
    if not raw or not raw.get("webhook_token_enc"):
        return False
    try:
        stored = decrypt_secret(raw["webhook_token_enc"])
        return secrets.compare_digest(stored, token)
    except Exception:
        return False


# ── Sync-Logs ─────────────────────────────────────────────────────────────────

async def create_sync_log(repo_type: str, triggered_by: str) -> int:
    """Legt einen neuen Sync-Log-Eintrag an (status='running'). Gibt id zurück."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_logs

    async with get_db() as db:
        result = await db.execute(
            git_sync_logs.insert().values(
                repo_type=repo_type,
                triggered_by=triggered_by,
                started_at=_now_iso(),
                completed_at=None,
                status="running",
                items_synced=0,
                items_conflicted=0,
                message=None,
                log_detail=None,
            )
        )
        await db.commit()
        return result.lastrowid


async def finish_sync_log(
    log_id: int,
    status: str,
    items_synced: int,
    items_conflicted: int,
    message: str | None = None,
    log_detail: str | None = None,
) -> None:
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_logs

    async with get_db() as db:
        await db.execute(
            git_sync_logs.update()
            .where(git_sync_logs.c.id == log_id)
            .values(
                completed_at=_now_iso(),
                status=status,
                items_synced=items_synced,
                items_conflicted=items_conflicted,
                message=message,
                log_detail=log_detail,
            )
        )
        await db.commit()

    await _prune_old_logs(log_id, status)  # warte nicht auf prune


async def _prune_old_logs(log_id: int, repo_type_from_id: str | None = None) -> None:
    """Behält nur die letzten 20 Einträge pro repo_type (AC-MISC-3)."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_logs
    from sqlalchemy import select, func, text

    # Zunächst repo_type des aktuellen Logs ermitteln
    async with get_db() as db:
        row = (await db.execute(
            select(git_sync_logs.c.repo_type).where(git_sync_logs.c.id == log_id)
        )).mappings().first()
        if not row:
            return
        repo_type = row["repo_type"]

        # IDs der letzten 20 ermitteln
        rows = (await db.execute(
            select(git_sync_logs.c.id)
            .where(git_sync_logs.c.repo_type == repo_type)
            .order_by(git_sync_logs.c.started_at.desc())
            .limit(20)
        )).scalars().all()

        if rows:
            keep_ids = list(rows)
            await db.execute(
                git_sync_logs.delete()
                .where(git_sync_logs.c.repo_type == repo_type)
                .where(git_sync_logs.c.id.notin_(keep_ids))
            )
            await db.commit()


async def list_sync_logs(repo_type: str) -> list[dict]:
    """Gibt die letzten 20 Sync-Logs zurück (neuste zuerst)."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_logs
    from sqlalchemy import select

    async with get_db() as db:
        rows = (await db.execute(
            select(git_sync_logs)
            .where(git_sync_logs.c.repo_type == repo_type)
            .order_by(git_sync_logs.c.started_at.desc())
            .limit(20)
        )).mappings().all()
        return [dict(r) for r in rows]


# ── Konflikt-Management ───────────────────────────────────────────────────────

async def list_conflicts(open_only: bool = True) -> list[dict]:
    """Gibt alle Konflikte zurück (offen oder alle)."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_conflicts
    from sqlalchemy import select

    async with get_db() as db:
        q = select(git_sync_conflicts).order_by(git_sync_conflicts.c.detected_at.desc())
        if open_only:
            q = q.where(git_sync_conflicts.c.resolved_at.is_(None))
        rows = (await db.execute(q)).mappings().all()
        return [dict(r) for r in rows]


async def resolve_conflict(conflict_id: int, resolution: str, actor: str) -> bool:
    """Löst einen Konflikt auf. Gibt True wenn erfolgreich."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_conflicts, git_sync_sources
    from sqlalchemy import select

    async with get_db() as db:
        row = (await db.execute(
            select(git_sync_conflicts).where(git_sync_conflicts.c.id == conflict_id)
        )).mappings().first()
        if not row:
            return False

        # Wenn 'git': Item aus Repo in Zielverzeichnis kopieren + sources-Eintrag
        if resolution == "git":
            await _apply_git_version(row["repo_type"], row["item_id"], row["git_hash"], db)

        now = _now_iso()
        await db.execute(
            git_sync_conflicts.update()
            .where(git_sync_conflicts.c.id == conflict_id)
            .values(
                resolved_at=now,
                resolution=resolution,
                resolved_by=actor,
            )
        )
        await db.commit()
    return True


async def _apply_git_version(repo_type: str, item_id: str, git_hash: str, db) -> None:
    """Kopiert ein Item aus dem Clone-Dir in das Zielverzeichnis."""
    from backend.plus.git_sync.models import git_sync_sources

    clone_dir = _get_clone_dir(repo_type)
    if not clone_dir.exists():
        logger.warning("Clone-Dir nicht vorhanden für %s – kann git-Version nicht anwenden", repo_type)
        return

    source_item = clone_dir / item_id
    if not source_item.is_dir():
        logger.warning("Item %s nicht im Clone-Dir gefunden", item_id)
        return

    target_dir = _get_target_dir(repo_type)
    target_item = target_dir / item_id

    try:
        if target_item.exists():
            shutil.rmtree(target_item)
        shutil.copytree(source_item, target_item, symlinks=False, ignore=shutil.ignore_patterns("*.pyc"))
        logger.info("Git-Version für %s/%s angewendet", repo_type, item_id)
    except Exception as exc:
        logger.error("Fehler beim Kopieren von %s/%s: %s", repo_type, item_id, exc)
        return

    # sources-Eintrag aktualisieren
    now = _now_iso()
    existing = (await db.execute(
        git_sync_sources.select()
        .where(git_sync_sources.c.repo_type == repo_type)
        .where(git_sync_sources.c.item_id == item_id)
    )).mappings().first()

    if existing:
        await db.execute(
            git_sync_sources.update()
            .where(git_sync_sources.c.repo_type == repo_type)
            .where(git_sync_sources.c.item_id == item_id)
            .values(git_hash=git_hash, synced_at=now)
        )
    else:
        await db.execute(
            git_sync_sources.insert().values(
                repo_type=repo_type,
                item_id=item_id,
                git_hash=git_hash,
                synced_at=now,
            )
        )


# ── Haupt-Sync-Logik ──────────────────────────────────────────────────────────

async def trigger_sync(repo_type: str, triggered_by: str = "manual") -> Literal["started", "queued"]:
    """Löst einen Sync aus. Falls einer läuft → queued (AC-ERR-5).

    Diese Methode kehrt sofort zurück; der Sync läuft im Hintergrund.
    """
    lock = _locks[repo_type]

    if lock.locked():
        _queued[repo_type] = True
        logger.info("Git-Sync %s bereits aktiv – queued", repo_type)
        return "queued"

    asyncio.create_task(_run_sync_with_queue(repo_type, triggered_by))
    return "started"


async def _run_sync_with_queue(repo_type: str, triggered_by: str) -> None:
    """Führt den Sync durch und prüft anschließend ob ein queued Trigger wartet."""
    lock = _locks[repo_type]
    async with lock:
        await _do_sync(repo_type, triggered_by)

    # Queued Trigger abarbeiten (max. 1)
    if _queued[repo_type]:
        _queued[repo_type] = False
        async with lock:
            await _do_sync(repo_type, triggered_by)


async def _do_sync(repo_type: str, triggered_by: str) -> None:
    """Kern-Sync-Logik: Clone/Fetch + Item-Import + Konflikt-Erkennung."""
    from backend.services.audit_service import write_audit_log
    from backend.services.config_service import decrypt_secret
    from backend.plus.git_sync import runner as git_runner
    from backend.plus.git_sync.models import git_sync_sources, git_sync_conflicts
    from backend.db.database import get_db
    from sqlalchemy import select

    log_id = await create_sync_log(repo_type, triggered_by)
    await write_audit_log(
        "git_sync_triggered",
        username="system",
        detail=f'{{"repo_type": "{repo_type}", "triggered_by": "{triggered_by}"}}',
    )

    raw_config = await get_config(repo_type)
    if not raw_config or not raw_config.get("enabled"):
        await finish_sync_log(log_id, "failed", 0, 0, "Git-Sync nicht konfiguriert oder deaktiviert")
        return

    # Auth-Daten entschlüsseln
    https_token: str | None = None
    ssh_private_key: str | None = None
    if raw_config.get("https_token_enc"):
        try:
            https_token = decrypt_secret(raw_config["https_token_enc"])
        except Exception:
            pass
    if raw_config.get("ssh_private_key_enc"):
        try:
            ssh_private_key = decrypt_secret(raw_config["ssh_private_key_enc"])
        except Exception:
            pass

    clone_dir = _get_clone_dir(repo_type)
    branch = raw_config.get("branch") or "main"
    auth_method = raw_config.get("auth_method") or "https"

    # Clone oder Fetch+Reset
    if clone_dir.exists():
        result = await git_runner.fetch_and_reset(
            clone_dir=clone_dir,
            branch=branch,
            auth_method=auth_method,
            repo_url=raw_config["repo_url"],
            https_username=raw_config.get("https_username"),
            https_token=https_token,
            ssh_private_key=ssh_private_key,
        )
    else:
        result = await git_runner.clone_repo(
            repo_url=raw_config["repo_url"],
            branch=branch,
            clone_dir=clone_dir,
            auth_method=auth_method,
            https_username=raw_config.get("https_username"),
            https_token=https_token,
            ssh_private_key=ssh_private_key,
        )

    if result.returncode != 0:
        err_msg = result.stderr[:500] or f"git exit {result.returncode}"
        await finish_sync_log(log_id, "failed", 0, 0, err_msg)
        await write_audit_log(
            "git_sync_failed",
            username="system",
            detail=f'{{"repo_type": "{repo_type}", "error": {_json_str(err_msg)}}}',
        )
        return

    # Subdir navigieren
    source_dir = clone_dir
    if raw_config.get("subdir"):
        source_dir = clone_dir / raw_config["subdir"]
        if not source_dir.is_dir():
            err = f"Unterordner '{raw_config['subdir']}' nicht im Repo gefunden"
            await finish_sync_log(log_id, "failed", 0, 0, err)
            await write_audit_log("git_sync_failed", username="system",
                                  detail=f'{{"repo_type": "{repo_type}", "error": {_json_str(err)}}}')
            return

    # Aktuellen HEAD-Hash ermitteln
    current_hash = await git_runner.get_current_hash(clone_dir) or "unknown"

    # Items sammeln
    items = git_runner.collect_items(source_dir)

    target_dir = _get_target_dir(repo_type)
    target_dir.mkdir(parents=True, exist_ok=True)

    items_synced = 0
    items_conflicted = 0
    error_details: list[str] = []

    async with get_db() as db:
        for item in items:
            item_id = item.item_id

            # sources-Eintrag prüfen
            source_row = (await db.execute(
                select(git_sync_sources)
                .where(git_sync_sources.c.repo_type == repo_type)
                .where(git_sync_sources.c.item_id == item_id)
            )).mappings().first()

            target_item = target_dir / item_id
            target_exists = target_item.exists()

            if source_row is None and target_exists:
                # Konflikt: Item existiert lokal (ZIP-Upload), kein sources-Eintrag
                await _register_conflict(db, repo_type, item_id, current_hash)
                items_conflicted += 1
                logger.info("Konflikt erkannt: %s/%s", repo_type, item_id)
                continue

            if source_row is not None and source_row["git_hash"] == current_hash:
                # Bereits aktuell
                continue

            # Neu oder Update: kopieren
            try:
                _copy_item(item.item_path, target_item)
                now = _now_iso()
                if source_row:
                    await db.execute(
                        git_sync_sources.update()
                        .where(git_sync_sources.c.repo_type == repo_type)
                        .where(git_sync_sources.c.item_id == item_id)
                        .values(git_hash=current_hash, synced_at=now)
                    )
                else:
                    await db.execute(
                        git_sync_sources.insert().values(
                            repo_type=repo_type,
                            item_id=item_id,
                            git_hash=current_hash,
                            synced_at=now,
                        )
                    )
                items_synced += 1
            except Exception as exc:
                error_details.append(f"{item_id}: {exc}")
                logger.error("Fehler beim Kopieren von %s/%s: %s", repo_type, item_id, exc)

        await db.commit()

    log_detail = "\n".join(error_details) if error_details else None
    if error_details:
        status = "failed" if items_synced == 0 else "success"
    else:
        status = "success"

    await finish_sync_log(log_id, status, items_synced, items_conflicted, log_detail=log_detail)
    await write_audit_log(
        "git_sync_completed",
        username="system",
        detail=(
            f'{{"repo_type": "{repo_type}", "items_synced": {items_synced}, '
            f'"items_conflicted": {items_conflicted}, "status": "{status}"}}'
        ),
    )
    logger.info("Git-Sync %s abgeschlossen: %s synced, %s conflicted", repo_type, items_synced, items_conflicted)


def _copy_item(source: Path, dest: Path) -> None:
    """Kopiert ein Item-Verzeichnis. Symlinks werden ignoriert."""
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest, symlinks=False, ignore=shutil.ignore_patterns("*.pyc"))


async def _register_conflict(db, repo_type: str, item_id: str, git_hash: str) -> None:
    """Legt einen neuen Konflikt-Eintrag an (oder aktualisiert den Hash)."""
    from backend.plus.git_sync.models import git_sync_conflicts
    from sqlalchemy import select

    existing = (await db.execute(
        select(git_sync_conflicts)
        .where(git_sync_conflicts.c.repo_type == repo_type)
        .where(git_sync_conflicts.c.item_id == item_id)
        .where(git_sync_conflicts.c.resolved_at.is_(None))
    )).mappings().first()

    if not existing:
        await db.execute(
            git_sync_conflicts.insert().values(
                repo_type=repo_type,
                item_id=item_id,
                git_hash=git_hash,
                detected_at=_now_iso(),
                resolved_at=None,
                resolution=None,
                resolved_by=None,
            )
        )


async def get_conflict_item_ids(repo_type: str | None = None) -> set[str]:
    """Gibt die Item-IDs aller offenen Konflikte zurück."""
    from backend.db.database import get_db
    from backend.plus.git_sync.models import git_sync_conflicts
    from sqlalchemy import select

    q = select(git_sync_conflicts.c.item_id).where(git_sync_conflicts.c.resolved_at.is_(None))
    if repo_type:
        q = q.where(git_sync_conflicts.c.repo_type == repo_type)
    async with get_db() as db:
        rows = (await db.execute(q)).scalars().all()
    return set(rows)


def _json_str(s: str) -> str:
    """Escaped einen String für JSON-Einbettung."""
    import json
    return json.dumps(s)
