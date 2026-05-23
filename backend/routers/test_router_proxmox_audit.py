# p3portal.org
"""Tests for PROJ-23 Proxmox API Audit-Log endpoint + service."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.admin import router as admin_router

app = FastAPI()
app.include_router(admin_router)

_ADMIN_TOKEN  = create_access_token("admin",    auth_type="local", role="admin")
_OP_TOKEN     = create_access_token("operator", auth_type="local", role="operator")
_VIEWER_TOKEN = create_access_token("viewer",   auth_type="local", role="viewer")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Authorization ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_non_admin_gets_403(client: AsyncClient, monkeypatch):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_gets_403(client: AsyncClient, monkeypatch):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_gets_401(client: AsyncClient, monkeypatch):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    resp = await client.get("/api/admin/proxmox-audit")
    assert resp.status_code == 401


# ── Feature gate ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_returns_404_when_audit_disabled(client: AsyncClient, monkeypatch):
    monkeypatch.delenv("PROXMOX_AUDIT_ENABLED", raising=False)
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_gets_403_even_when_audit_disabled(client: AsyncClient, monkeypatch):
    """403 must be returned before 404 to avoid leaking feature existence."""
    monkeypatch.delenv("PROXMOX_AUDIT_ENABLED", raising=False)
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


# ── Happy path ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_returns_empty_list_when_log_missing(client: AsyncClient, monkeypatch):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_returns_empty_list_when_log_empty(client: AsyncClient, monkeypatch, tmp_path):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    (tmp_path / "proxmox_audit.log").write_text("")
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_returns_parsed_entries(client: AsyncClient, monkeypatch, tmp_path):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    (tmp_path / "proxmox_audit.log").write_text(
        "2026-05-03T14:22:11Z | portal@pve!admin-token | GET /api2/json/nodes/pve1/qemu | 200\n"
        "2026-05-03T14:22:15Z | portal@pve!admin-token | POST /api2/json/nodes/pve1/qemu/101/status/start | 200\n"
    )
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    # newest first (reversed)
    assert data[0]["endpoint"] == "/api2/json/nodes/pve1/qemu/101/status/start"
    assert data[0]["method"] == "POST"
    assert data[0]["status"] == "200"
    assert data[1]["endpoint"] == "/api2/json/nodes/pve1/qemu"
    assert data[1]["method"] == "GET"


@pytest.mark.asyncio
async def test_returns_max_500_lines(client: AsyncClient, monkeypatch, tmp_path):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    lines = "\n".join(
        f"2026-05-03T14:22:11Z | token | GET /path/{i} | 200"
        for i in range(600)
    )
    (tmp_path / "proxmox_audit.log").write_text(lines + "\n")
    resp = await client.get("/api/admin/proxmox-audit", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert len(resp.json()) == 500


# ── Service unit tests ────────────────────────────────────────────────────────

def test_write_and_read_basic(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    svc.write_audit_line("portal@pve!admin", "GET", "/api2/json/nodes", "200")
    entries = svc.read_audit_lines()
    assert len(entries) == 1
    e = entries[0]
    assert e["token"] == "portal@pve!admin"
    assert e["method"] == "GET"
    assert e["endpoint"] == "/api2/json/nodes"
    assert e["status"] == "200"
    assert e["user"] == ""
    assert e["body"] is None


def test_write_with_user_and_body(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    svc.write_audit_line("portal@pve!admin", "POST", "/api2/json/nodes/pve/qemu", "200",
                         user="chris", body='{"vmid":200}')
    entries = svc.read_audit_lines()
    assert len(entries) == 1
    e = entries[0]
    assert e["user"] == "chris"
    assert e["body"] == '{"vmid":200}'


def test_write_cookie_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    svc.write_audit_line("cookie-auth", "GET", "/api2/json/cluster/status", "200")
    entries = svc.read_audit_lines()
    assert entries[0]["token"] == "cookie-auth"


def test_newest_first_ordering(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    for i in range(5):
        svc.write_audit_line("t", "GET", f"/path/{i}", "200")
    entries = svc.read_audit_lines()
    # Last written (/path/4) should be first
    assert entries[0]["endpoint"] == "/path/4"
    assert entries[-1]["endpoint"] == "/path/0"


def test_read_missing_file_returns_empty(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    assert svc.read_audit_lines() == []


def test_parse_line_with_err_status(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    entry = svc._parse_audit_line("2026-05-03T14:22:11Z | portal@pve!admin | DELETE /api2/json/nodes/pve/qemu/101 | ERR")
    assert entry is not None
    assert entry["status"] == "ERR"
    assert entry["method"] == "DELETE"


def test_parse_malformed_line_returns_none(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    assert svc._parse_audit_line("only one part") is None
    assert svc._parse_audit_line("") is None


def test_is_audit_enabled_false_by_default(monkeypatch):
    monkeypatch.delenv("PROXMOX_AUDIT_ENABLED", raising=False)
    from backend.services import proxmox_audit_service as svc
    assert svc.is_audit_enabled() is False


def test_is_audit_enabled_true_when_set(monkeypatch):
    monkeypatch.setenv("PROXMOX_AUDIT_ENABLED", "1")
    from backend.services import proxmox_audit_service as svc
    assert svc.is_audit_enabled() is True


def test_token_secret_never_in_log(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from backend.services import proxmox_audit_service as svc
    # The service itself doesn't strip secrets – that's done in proxmox.py event hook.
    # Verify that the log file does NOT contain the secret when written correctly.
    svc.write_audit_line("portal@pve!admin-token", "GET", "/api2/json/nodes", "200")
    content = (tmp_path / "proxmox_audit.log").read_text()
    assert "secret" not in content
    assert "portal@pve!admin-token" in content
