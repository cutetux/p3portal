# p3portal.org
"""Tests für revoke_all_for_user (PROJ-67 Phase 1 – F-003)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def _mock_db(monkeypatch):
    """Minimal DB mock: execute() returns rowcount, commit() is a no-op."""
    mock_result = MagicMock()
    mock_result.rowcount = 3

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(return_value=mock_result)
    mock_db.commit = AsyncMock()
    mock_db.__aenter__ = AsyncMock(return_value=mock_db)
    mock_db.__aexit__ = AsyncMock(return_value=False)

    import backend.services.session_service as ss
    monkeypatch.setattr("backend.services.session_service.get_db", lambda: mock_db)
    return mock_db, mock_result


@pytest.mark.asyncio
async def test_revoke_all_for_user_no_except(_mock_db):
    mock_db, mock_result = _mock_db
    mock_result.rowcount = 2

    import backend.services.session_service as ss

    with patch("backend.services.audit_service.write_audit_log", new_callable=AsyncMock):
        count = await ss.revoke_all_for_user("alice", "password_reset")

    assert count == 2
    # SQL must NOT contain except_jti filter when none given
    sql_call = mock_db.execute.call_args_list[0]
    params = sql_call.args[1]
    assert "jti" not in params


@pytest.mark.asyncio
async def test_revoke_all_for_user_with_except(_mock_db, monkeypatch):
    mock_db, mock_result = _mock_db
    mock_result.rowcount = 1

    import backend.services.session_service as ss

    with patch("backend.services.audit_service.write_audit_log", new_callable=AsyncMock) as mock_audit:
        count = await ss.revoke_all_for_user("alice", "self_password_change", except_jti="keep-jti")

    assert count == 1
    # SQL must use jti != filter
    sql_call = mock_db.execute.call_args_list[0]
    params = sql_call.args[1]
    assert params.get("jti") == "keep-jti"


@pytest.mark.asyncio
async def test_revoke_all_writes_audit_event(_mock_db, monkeypatch):
    mock_db, mock_result = _mock_db
    mock_result.rowcount = 5

    import backend.services.session_service as ss
    captured: list = []

    async def capture(event_type, username=None, detail=None, **_kw):
        captured.append({"event_type": event_type, "username": username, "detail": detail})

    with patch("backend.services.audit_service.write_audit_log", side_effect=capture):
        await ss.revoke_all_for_user("bob", "user_disabled")

    assert len(captured) == 1
    evt = captured[0]
    assert evt["event_type"] == "sessions_bulk_revoked"
    assert evt["username"] == "bob"
    assert "user_disabled" in evt["detail"]
    assert "5" in evt["detail"]


@pytest.mark.asyncio
async def test_revoke_returns_zero_when_no_sessions(_mock_db, monkeypatch):
    mock_db, mock_result = _mock_db
    mock_result.rowcount = 0

    import backend.services.session_service as ss

    with patch("backend.services.audit_service.write_audit_log", new_callable=AsyncMock):
        count = await ss.revoke_all_for_user("nobody", "password_reset")

    assert count == 0
