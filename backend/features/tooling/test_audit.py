# p3portal.org
"""PROJ-66: Tests für audit.py (emit_status_transition)."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend.features.tooling.audit import _truncate, emit_status_transition


# ── _truncate ────────────────────────────────────────────────────────────────

def test_truncate_short_text():
    assert _truncate("hello") == "hello"


def test_truncate_none():
    assert _truncate(None) is None


def test_truncate_empty():
    assert _truncate("") is None


def test_truncate_long_text():
    text = "word " * 200  # >> 500 Zeichen
    result = _truncate(text)
    assert result is not None
    assert len(result) <= 510  # 500 + "…" Puffer
    assert result.endswith("…")


def test_truncate_exact_limit():
    text = "a" * 500
    result = _truncate(text)
    assert result == text  # genau 500 → kein Truncation


# ── emit_status_transition ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_emit_skips_unknown_to_x():
    """unknown → ready darf NICHT auditiert werden (AC-AUDIT-2)."""
    with patch("backend.features.tooling.audit.write_audit_log", new_callable=AsyncMock) as mock_log:
        await emit_status_transition("ansible", "unknown", "ready", "2.18.1", "")
    mock_log.assert_not_called()


@pytest.mark.asyncio
async def test_emit_skips_same_status():
    """ready → ready darf NICHT auditiert werden (AC-AUDIT-3)."""
    with patch("backend.features.tooling.audit.write_audit_log", new_callable=AsyncMock) as mock_log:
        await emit_status_transition("ansible", "ready", "ready", "2.18.1", "")
    mock_log.assert_not_called()


@pytest.mark.asyncio
async def test_emit_writes_on_transition():
    """ready → down MUSS auditiert werden."""
    with patch("backend.features.tooling.audit.write_audit_log", new_callable=AsyncMock) as mock_log:
        await emit_status_transition("ansible", "ready", "down", "2.18.1", "ansible: error")
    mock_log.assert_called_once()

    call_kwargs = mock_log.call_args.kwargs
    assert call_kwargs["event_type"] == "tooling_status_changed"
    assert call_kwargs["auth_type"] == "tooling"
    assert call_kwargs["username"] is None

    payload = json.loads(call_kwargs["detail"])
    assert payload["tool"] == "ansible"
    assert payload["from"] == "ready"
    assert payload["to"] == "down"
    assert payload["version"] == "2.18.1"


@pytest.mark.asyncio
async def test_emit_stderr_excerpt_truncated():
    """Langer stderr wird auf 500 Zeichen begrenzt (AC-AUDIT-5)."""
    long_err = "error " * 200  # >> 500 Zeichen

    with patch("backend.features.tooling.audit.write_audit_log", new_callable=AsyncMock) as mock_log:
        await emit_status_transition("packer", "ready", "down", None, long_err)

    payload = json.loads(mock_log.call_args.kwargs["detail"])
    excerpt = payload.get("stderr_excerpt", "")
    assert excerpt is not None
    assert len(excerpt) <= 510  # 500 + "…" Puffer


@pytest.mark.asyncio
async def test_emit_survives_write_failure():
    """Audit-Fehler darf nicht propagiert werden."""
    with patch(
        "backend.features.tooling.audit.write_audit_log",
        new_callable=AsyncMock,
        side_effect=Exception("DB down"),
    ):
        # Kein Exception erwartet
        await emit_status_transition("ansible", "ready", "down", "2.18.1", "")
