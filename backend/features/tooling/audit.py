# p3portal.org
"""PROJ-66: Audit-Emission bei Tool-Status-Transitions.

Schreibt in die bestehende audit_logs-Tabelle (PROJ-23).
- user_id = NULL (System-Event)  → username = None
- auth_type = "tooling"          → Quelle klar erkennbar
- detail = JSON-Payload mit tool/from/to/version/stderr_excerpt

Branches (AC-AUDIT-2/3):
  unknown → x    → NICHT auditieren (Initial-Übergang)
  x → x          → NICHT auditieren (kein Wechsel)
  x → y          → auditieren
"""
from __future__ import annotations

import json
import logging

from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

_STDERR_EXCERPT_MAX = 500  # Zeichen-Limit für stderr_excerpt (AC-AUDIT-5)


def _truncate(text: str | None, max_len: int = _STDERR_EXCERPT_MAX) -> str | None:
    if not text:
        return None
    text = text.strip()
    if len(text) <= max_len:
        return text
    # Am letzten Wortende abschneiden
    truncated = text[:max_len]
    last_space = truncated.rfind(" ")
    if last_space > max_len // 2:
        truncated = truncated[:last_space]
    return truncated + "…"


async def emit_status_transition(
    tool: str,
    from_status: str,
    to_status: str,
    version: str | None,
    stderr: str | None,
) -> None:
    """Schreibt ein Audit-Event bei echtem Status-Wechsel.

    Wird innerhalb des Service-Locks aufgerufen (Tech-Design §G).
    Wirft keine Exception (Audit darf nie den Hauptfluss unterbrechen).
    """
    # AC-AUDIT-2: unknown → x nicht auditieren
    if from_status == "unknown":
        return
    # AC-AUDIT-3: kein Wechsel
    if from_status == to_status:
        return

    payload = {
        "tool": tool,
        "from": from_status,
        "to": to_status,
        "version": version,
        "stderr_excerpt": _truncate(stderr),
    }

    try:
        await write_audit_log(
            event_type="tooling_status_changed",
            username=None,            # System-Event (AC-AUDIT-4)
            auth_type="tooling",      # Quelle klar erkennbar für Abfragen
            ip_address=None,
            user_agent=None,
            detail=json.dumps(payload),
        )
        logger.info("Tooling audit: %s %s → %s", tool, from_status, to_status)
    except Exception as exc:
        logger.warning("Tooling audit write failed (non-fatal): %s", exc)
