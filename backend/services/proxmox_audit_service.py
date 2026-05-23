# p3portal.org
"""PROJ-23: Proxmox API Audit-Log service.

Activated via PROXMOX_AUDIT_ENABLED env var.  Without it, no log is written
and no X-Portal-User header is ever attached to outgoing Proxmox calls.
"""
from __future__ import annotations

import logging
import logging.handlers
import os
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path

# Per-request ContextVar: set by get_current_user, read by the httpx event hook.
portal_user_var: ContextVar[str] = ContextVar("portal_user", default="")

# PROJ-67 Phase 1 – F-013: module-level logger cache (one per log-path)
_audit_logger_cache: dict[str, logging.Logger] = {}


def _log_path() -> Path:
    data_dir = os.environ.get("DATA_DIR", "/app/data")
    return Path(data_dir) / "proxmox_audit.log"


def _get_audit_logger() -> logging.Logger:
    """Return a RotatingFileHandler-backed logger for the audit log.

    PROJ-67 Phase 1 – F-013: 10 MB per file, 10 backup files.
    """
    log_path = str(_log_path())
    if log_path in _audit_logger_cache:
        return _audit_logger_cache[log_path]

    max_bytes = int(os.environ.get("PROXMOX_AUDIT_LOG_MAX_BYTES", 10 * 1024 * 1024))
    backup_count = int(os.environ.get("PROXMOX_AUDIT_LOG_BACKUPS", 10))

    logger = logging.getLogger(f"proxmox_audit.{log_path}")
    logger.setLevel(logging.INFO)
    logger.propagate = False

    if not logger.handlers:
        try:
            Path(log_path).parent.mkdir(parents=True, exist_ok=True)
            handler = logging.handlers.RotatingFileHandler(
                log_path,
                maxBytes=max_bytes,
                backupCount=backup_count,
                encoding="utf-8",
            )
            handler.setFormatter(logging.Formatter("%(message)s"))
            logger.addHandler(handler)
        except Exception:
            pass

    _audit_logger_cache[log_path] = logger
    return logger


def is_audit_enabled() -> bool:
    return bool(os.environ.get("PROXMOX_AUDIT_ENABLED"))


def is_log_body_enabled() -> bool:
    return bool(os.environ.get("PROXMOX_AUDIT_LOG_BODY"))


def is_debug_user_enabled() -> bool:
    return bool(os.environ.get("PROXMOX_AUDIT_DEBUG_USER"))


def write_audit_line(
    token: str,
    method: str,
    path: str,
    status: str,
    *,
    user: str = "",
    body: str = "",
) -> None:
    """Append one audit entry via RotatingFileHandler (PROJ-67 Phase 1 – F-013)."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    parts = [ts, token]
    if user:
        parts.append(f"user={user}")
    parts.append(f"{method} {path}")
    if body:
        parts.append(f"body={body}")
    parts.append(status)
    line = " | ".join(parts)
    try:
        _get_audit_logger().info(line)
    except Exception:
        pass


def read_audit_lines(n: int = 500) -> list[dict]:
    """Return the last *n* log entries, newest first, parsed into dicts."""
    log_file = _log_path()
    if not log_file.exists():
        return []
    try:
        text = log_file.read_text(encoding="utf-8")
        lines = [ln for ln in text.splitlines() if ln.strip()]
    except Exception:
        return []
    lines = lines[-n:]
    lines.reverse()
    result = []
    for line in lines:
        entry = _parse_audit_line(line)
        if entry is not None:
            result.append(entry)
    return result


def _parse_audit_line(line: str) -> dict | None:
    """Parse one pipe-separated audit line into a dict.

    Format: timestamp | token | [user=x |] METHOD URL [| body=x] | status
    """
    parts = [p.strip() for p in line.split(" | ")]
    if len(parts) < 3:
        return None

    entry: dict = {
        "timestamp": parts[0],
        "token": parts[1],
        "user": "",
        "method": "",
        "endpoint": "",
        "status": parts[-1],
        "body": None,
    }

    for part in parts[2:-1]:
        if part.startswith("user="):
            entry["user"] = part[5:]
        elif part.startswith("body="):
            entry["body"] = part[5:]
        else:
            idx = part.find(" ")
            if idx > 0:
                entry["method"] = part[:idx]
                entry["endpoint"] = part[idx + 1:]

    return entry
