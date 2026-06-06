# p3portal.org
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.routers.vms import router
from backend.services.proxmox import ProxmoxAuth, _sessions, proxmox_client

app = FastAPI()
app.include_router(router)

_FAKE_SESSION = {
    "ticket": "PVE:testuser@pam:FAKETICKET",
    "csrf": "FAKE:CSRF",
    "cap": {},
}
_FAKE_AUTH_OPERATOR = ProxmoxAuth(
    kind="token",
    value="portal-operator@pve!portal-operator",
    secret="fake-operator-uuid",
)
_FAKE_AUTH_ADMIN = ProxmoxAuth(
    kind="token",
    value="portal-admin@pve!portal-admin",
    secret="fake-admin-uuid",
)
_FAKE_UPID = "UPID:pve1:00001234:00000001:deadbeef:qmstart:100:root@pam:"


@pytest.fixture(autouse=True)
def inject_proxmox_session():
    _sessions["proxmox-user@pam"] = _FAKE_SESSION
    yield
    _sessions.clear()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def operator_local_headers():
    token = create_access_token("localop", auth_type="local", role="operator")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_local_headers():
    token = create_access_token("localadmin", auth_type="local", role="admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def viewer_local_headers():
    token = create_access_token("localview", auth_type="local", role="viewer")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def proxmox_operator_headers():
    token = create_access_token("proxmox-user@pam", auth_type="proxmox", role="operator")
    return {"Authorization": f"Bearer {token}"}


# ── Helpers ───────────────────────────────────────────────────────────────────

# Mocks return (client, auth, proxmox_node, vm_type). The client is the real
# global proxmox_client so downstream patches on proxmox_client.<method> still
# apply (route handlers reference the bound name imported at module level).
_PATCH_VM_ACCESS_OPERATOR = lambda: patch(  # noqa: E731
    "backend.routers.vms._resolve_vm_access",
    new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_OPERATOR, "pve1", "qemu")),
)
_PATCH_VM_ACCESS_ADMIN = lambda: patch(  # noqa: E731
    "backend.routers.vms._resolve_vm_access",
    new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_ADMIN, "pve1", "qemu")),
)


def _patch_vm_access_missing():
    from fastapi import HTTPException
    return patch(
        "backend.routers.vms._resolve_vm_access",
        new=AsyncMock(side_effect=HTTPException(503, "service account not configured")),
    )


# ── VM Start ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vm_start_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/start", headers=operator_local_headers)
    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_vm_start_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.post("/api/vms/100/start", headers=viewer_local_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_vm_start_unauthenticated(client: AsyncClient):
    resp = await client.post("/api/vms/100/start")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_vm_start_missing_token_503(client: AsyncClient, operator_local_headers: dict):
    with _patch_vm_access_missing():
        resp = await client.post("/api/vms/100/start", headers=operator_local_headers)
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_vm_start_vm_not_found(client: AsyncClient, operator_local_headers: dict):
    from fastapi import HTTPException as _HTTPException
    with patch(
        "backend.routers.vms._resolve_vm_access",
        new=AsyncMock(side_effect=_HTTPException(status_code=404, detail="VM 999 not found")),
    ):
        resp = await client.post("/api/vms/999/start", headers=operator_local_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_vm_start_proxmox_user(client: AsyncClient, proxmox_operator_headers: dict):
    cookie_auth = ProxmoxAuth(
        kind="cookie", value=_FAKE_SESSION["ticket"], csrf=_FAKE_SESSION["csrf"]
    )
    with (
        patch(
            "backend.routers.vms._resolve_vm_access",
            new=AsyncMock(return_value=(proxmox_client, cookie_auth, "pve1", "qemu")),
        ),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/start", headers=proxmox_operator_headers)
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_vm_start_with_explicit_node_query(
    client: AsyncClient, operator_local_headers: dict
):
    """Multi-Node: ?node=<name> is forwarded into _resolve_vm_access unchanged."""
    captured = {}

    async def _fake(_current_user, _vmid, proxmox_node=None):
        captured["proxmox_node"] = proxmox_node
        return proxmox_client, _FAKE_AUTH_OPERATOR, proxmox_node or "pve1", "qemu"

    with (
        patch("backend.routers.vms._resolve_vm_access", new=AsyncMock(side_effect=_fake)),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/start?node=pve2", headers=operator_local_headers
        )
    assert resp.status_code == 200
    assert captured["proxmox_node"] == "pve2"


# ── VM Stop ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vm_stop_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/stop", headers=operator_local_headers)
    assert resp.status_code == 200
    assert "task_id" in resp.json()


# ── VM Reboot ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_vm_reboot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post("/api/vms/100/reboot", headers=operator_local_headers)
    assert resp.status_code == 200


# ── VM Config Update (CPU/RAM) ────────────────────────────────────────────────

_PATCH_AUDIT = lambda: patch(  # noqa: E731
    "backend.routers.vms.write_audit_log", new=AsyncMock(return_value=None)
)


@pytest.mark.asyncio
async def test_update_vm_config_success(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_put(_auth, node, vmid, updates, delete_keys=None, vm_type="qemu"):
        captured.update(updates=updates, delete_keys=delete_keys, vm_type=vm_type)

    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.put_vm_config", new=AsyncMock(side_effect=_fake_put)),
    ):
        resp = await client.patch(
            "/api/vms/100/config",
            headers=operator_local_headers,
            json={"cores": 4, "memory": 4096, "onboot": True},
        )
    assert resp.status_code == 204
    assert captured["updates"] == {"cores": 4, "memory": 4096, "onboot": 1}


@pytest.mark.asyncio
async def test_update_vm_config_no_changes_400(client: AsyncClient, operator_local_headers: dict):
    with (_PATCH_VM_ACCESS_OPERATOR(), _PATCH_AUDIT()):
        resp = await client.patch("/api/vms/100/config", headers=operator_local_headers, json={})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_update_vm_config_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.patch(
            "/api/vms/100/config", headers=viewer_local_headers, json={"cores": 2}
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_update_vm_config_sockets_ignored_for_lxc(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_put(_auth, node, vmid, updates, delete_keys=None, vm_type="lxc"):
        captured.update(updates=updates, delete_keys=delete_keys)

    with (
        patch(
            "backend.routers.vms._resolve_vm_access",
            new=AsyncMock(return_value=(proxmox_client, _FAKE_AUTH_OPERATOR, "pve1", "lxc")),
        ),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.put_vm_config", new=AsyncMock(side_effect=_fake_put)),
    ):
        resp = await client.patch(
            "/api/vms/200/config",
            headers=operator_local_headers,
            json={"cores": 2, "sockets": 2, "swap": 512},
        )
    assert resp.status_code == 204
    # sockets dropped (LXC), swap kept
    assert "sockets" not in captured["updates"]
    assert captured["updates"]["swap"] == 512


@pytest.mark.asyncio
async def test_update_vm_config_clear_description(client: AsyncClient, operator_local_headers: dict):
    captured = {}

    async def _fake_put(_auth, node, vmid, updates, delete_keys=None, vm_type="qemu"):
        captured.update(updates=updates, delete_keys=delete_keys)

    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        _PATCH_AUDIT(),
        patch("backend.routers.vms.proxmox_client.put_vm_config", new=AsyncMock(side_effect=_fake_put)),
    ):
        resp = await client.patch(
            "/api/vms/100/config", headers=operator_local_headers, json={"description": "  "}
        )
    assert resp.status_code == 204
    assert captured["delete_keys"] == ["description"]


@pytest.mark.asyncio
async def test_update_vm_config_invalid_memory_422(client: AsyncClient, operator_local_headers: dict):
    with (_PATCH_VM_ACCESS_OPERATOR(), _PATCH_AUDIT()):
        resp = await client.patch(
            "/api/vms/100/config", headers=operator_local_headers, json={"memory": 1}
        )
    assert resp.status_code == 422


# ── Snapshots ─────────────────────────────────────────────────────────────────

_FAKE_SNAPSHOTS = [
    {"name": "current", "parent": "snap1", "description": ""},
    {"name": "snap1", "snaptime": 1713897600, "description": "Before update", "parent": ""},
]


@pytest.mark.asyncio
async def test_list_snapshots_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.get_snapshots",
            new=AsyncMock(return_value=_FAKE_SNAPSHOTS),
        ),
    ):
        resp = await client.get("/api/vms/100/snapshots", headers=operator_local_headers)
    assert resp.status_code == 200
    body = resp.json()
    # "current" pseudo-snapshot must be filtered out
    assert all(s["name"] != "current" for s in body)
    assert len(body) == 1
    assert body[0]["name"] == "snap1"


@pytest.mark.asyncio
async def test_list_snapshots_viewer_forbidden(client: AsyncClient, viewer_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch("backend.routers.vms.get_user_by_username", new=AsyncMock(return_value=None)),
    ):
        resp = await client.get("/api/vms/100/snapshots", headers=viewer_local_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_snapshot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.create_snapshot",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/snapshots",
            json={"name": "my-snap", "description": "test"},
            headers=operator_local_headers,
        )
    assert resp.status_code == 202
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_create_snapshot_invalid_name(client: AsyncClient, operator_local_headers: dict):
    with _PATCH_VM_ACCESS_OPERATOR():
        resp = await client.post(
            "/api/vms/100/snapshots",
            json={"name": "bad name with spaces!"},
            headers=operator_local_headers,
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_rollback_snapshot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.rollback_snapshot",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.post(
            "/api/vms/100/snapshots/snap1/rollback",
            headers=operator_local_headers,
        )
    assert resp.status_code == 200
    assert "task_id" in resp.json()


@pytest.mark.asyncio
async def test_delete_snapshot_success(client: AsyncClient, operator_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_OPERATOR(),
        patch(
            "backend.routers.vms.proxmox_client.delete_snapshot",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.delete(
            "/api/vms/100/snapshots/snap1",
            headers=operator_local_headers,
        )
    assert resp.status_code == 200


# ── VM Delete ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_vm_success_admin(client: AsyncClient, admin_local_headers: dict):
    with (
        _PATCH_VM_ACCESS_ADMIN(),
        patch(
            "backend.routers.vms.proxmox_client.delete_vm",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client.delete("/api/vms/100", headers=admin_local_headers)
    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_delete_vm_operator_forbidden(client: AsyncClient, operator_local_headers: dict):
    resp = await client.delete("/api/vms/100", headers=operator_local_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_vm_unauthenticated(client: AsyncClient):
    resp = await client.delete("/api/vms/100")
    assert resp.status_code in (401, 403)


# ── Service Account Status ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_service_account_status_admin(client: AsyncClient, admin_local_headers: dict):
    with patch(
        "backend.routers.vms.get_service_account_status",
        new=AsyncMock(return_value={"viewer": True, "operator": True, "admin": False}),
    ):
        resp = await client.get("/api/service-accounts/status", headers=admin_local_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["viewer"] is True
    assert body["admin"] is False


@pytest.mark.asyncio
async def test_service_account_status_operator_forbidden(
    client: AsyncClient, operator_local_headers: dict
):
    resp = await client.get("/api/service-accounts/status", headers=operator_local_headers)
    assert resp.status_code == 403
