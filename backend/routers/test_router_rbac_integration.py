# p3portal.org
"""
Integration tests for RBAC enforcement in cluster.py (VM filtering)
and vms.py (action blocking).

Design rules (as of PROJ-29):
- admin / operator: portal-wide access, RBAC assignments are ignored.
- viewer without assignments: sees all VMs, cannot mutate.
- viewer with assignments: sees ONLY assigned VMs, can only do what preset allows.
- restricted without assignments: sees NO VMs, cannot mutate.
- restricted with assignments: sees ONLY assigned VMs, can only do what preset allows.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.cluster import router as cluster_router
from backend.routers.vms import router as vms_router
from backend.routers.admin import router as admin_router
from backend.services.proxmox import ProxmoxAuth, proxmox_client

app = FastAPI()
app.include_router(cluster_router)
app.include_router(vms_router)
app.include_router(admin_router)

_FAKE_VIEWER_AUTH = ProxmoxAuth(kind="token", value="portal-viewer@pve!viewer", secret="fake-viewer")
_FAKE_OPERATOR_AUTH = ProxmoxAuth(kind="token", value="portal-operator@pve!operator", secret="fake-operator")
_FAKE_UPID = "UPID:pve1:00001234:00000001:deadbeef:qmstart:100:root@pam:"

_FAKE_VMS = [
    {
        "vmid": 100, "name": "web-server", "type": "qemu",
        "status": "running", "node": "pve1",
        "cpu": 0.05, "maxcpu": 2,
        "mem": 1073741824, "maxmem": 2147483648,
        "uptime": 3600,
    },
    {
        "vmid": 200, "name": "db-server", "type": "qemu",
        "status": "stopped", "node": "pve1",
        "cpu": 0.0, "maxcpu": 4,
        "mem": 0, "maxmem": 4294967296,
        "uptime": 0,
    },
    {
        "vmid": 300, "name": "proxy", "type": "lxc",
        "status": "running", "node": "pve1",
        "cpu": 0.02, "maxcpu": 1,
        "mem": 536870912, "maxmem": 1073741824,
        "uptime": 7200,
    },
]


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db():
    await init_db()


@pytest_asyncio.fixture
async def client(db):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def client_with_operator(db):
    from backend.services.local_auth import create_user
    await create_user("rbac_operator", "SecurePass1234", "operator")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def client_with_viewer(db):
    from backend.services.local_auth import create_user
    await create_user("rbac_viewer", "SecurePass1234", "viewer")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def client_with_restricted(db):
    from backend.services.local_auth import create_user
    await create_user("rbac_restricted", "SecurePass1234", "restricted")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _op_headers(username: str = "rbac_operator") -> dict:
    token = create_access_token(username, auth_type="local", role="operator")
    return {"Authorization": f"Bearer {token}"}


def _viewer_headers(username: str = "rbac_viewer") -> dict:
    token = create_access_token(username, auth_type="local", role="viewer")
    return {"Authorization": f"Bearer {token}"}


def _restricted_headers(username: str = "rbac_restricted") -> dict:
    token = create_access_token(username, auth_type="local", role="restricted")
    return {"Authorization": f"Bearer {token}"}


def _admin_headers() -> dict:
    token = create_access_token("admin", auth_type="local", role="admin")
    return {"Authorization": f"Bearer {token}"}


_PATCH_CLUSTER_AUTH = lambda: patch(  # noqa: E731
    "backend.routers.cluster._get_cluster_auth",
    new=AsyncMock(return_value=_FAKE_VIEWER_AUTH),
)
_PATCH_VM_AUTH = lambda: patch(  # noqa: E731
    "backend.routers.vms._resolve_vm_access",
    new=AsyncMock(return_value=(proxmox_client, _FAKE_OPERATOR_AUTH, "pve1", "qemu")),
)


# ── cluster.py: GET /api/cluster/vms ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_operator_without_assignments_sees_all_vms(client_with_operator):
    """Operator without assignments sees all VMs (portal-wide access)."""
    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client_with_operator.get("/api/cluster/vms", headers=_op_headers())

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    for vm in data:
        assert vm["permissions"] is None


@pytest.mark.asyncio
async def test_operator_with_assignments_still_sees_all_vms(client_with_operator):
    """Operator with RBAC assignments ignores them and sees all VMs (portal-wide)."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_operator")
    preset = await create_preset("View+Start", "", ["view", "start"], created_by="admin")
    await create_assignment(user["id"], "vm", 100, preset.id, created_by="admin")

    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client_with_operator.get("/api/cluster/vms", headers=_op_headers())

    assert resp.status_code == 200
    assert len(resp.json()) == 3  # all VMs, RBAC ignored for operator


@pytest.mark.asyncio
async def test_viewer_without_assignments_sees_all_vms(client_with_viewer):
    """Viewer without assignments sees all VMs (portal-wide read access)."""
    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client_with_viewer.get("/api/cluster/vms", headers=_viewer_headers())

    assert resp.status_code == 200
    assert len(resp.json()) == 3


@pytest.mark.asyncio
async def test_viewer_with_assignments_sees_only_assigned_vms(client_with_viewer):
    """Viewer with assignments enters RBAC mode: sees only assigned VMs."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_viewer")
    preset = await create_preset("View+Start", "", ["view", "start"], created_by="admin")
    await create_assignment(user["id"], "vm", 100, preset.id, created_by="admin")
    preset2 = await create_preset("ViewOnly", "", ["view"], created_by="admin")
    await create_assignment(user["id"], "lxc", 300, preset2.id, created_by="admin")

    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client_with_viewer.get("/api/cluster/vms", headers=_viewer_headers())

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    ids = {vm["vmid"] for vm in data}
    assert ids == {100, 300}

    vm100 = next(v for v in data if v["vmid"] == 100)
    assert set(vm100["permissions"]) == {"view", "start"}

    vm300 = next(v for v in data if v["vmid"] == 300)
    assert set(vm300["permissions"]) == {"view"}


@pytest.mark.asyncio
async def test_restricted_without_assignments_sees_no_vms(client_with_restricted):
    """Restricted without assignments sees an empty VM list."""
    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client_with_restricted.get("/api/cluster/vms", headers=_restricted_headers())

    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_restricted_with_assignments_sees_only_assigned_vms(client_with_restricted):
    """Restricted with assignments sees only assigned VMs."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_restricted")
    preset = await create_preset("ProjectPreset", "", ["view", "start", "stop"], created_by="admin")
    await create_assignment(user["id"], "vm", 200, preset.id, created_by="admin")

    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client_with_restricted.get("/api/cluster/vms", headers=_restricted_headers())

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["vmid"] == 200
    assert set(data[0]["permissions"]) == {"view", "start", "stop"}


@pytest.mark.asyncio
async def test_admin_bypass_sees_all_vms(client):
    """Portal admin is never filtered, always sees all VMs."""
    with (
        _PATCH_CLUSTER_AUTH(),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=False),
        patch(
            "backend.routers.cluster.proxmox_client.get_cluster_resources_v2",
            new=AsyncMock(return_value=_FAKE_VMS),
        ),
        patch(
            "backend.routers.cluster.proxmox_client.get_vm_ip",
            new=AsyncMock(return_value=None),
        ),
    ):
        resp = await client.get("/api/cluster/vms", headers=_admin_headers())

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    for vm in data:
        assert vm["permissions"] is None


# ── vms.py: RBAC action enforcement ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_operator_without_assignments_can_start_vm(client_with_operator):
    """Operator without assignments can always start VMs (portal-wide access)."""
    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_operator.post("/api/vms/100/start", headers=_op_headers())

    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_operator_with_assignments_can_start_any_vm(client_with_operator):
    """Operator with RBAC assignments ignores them for actions (portal-wide)."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_operator")
    preset = await create_preset("ViewOnly", "", ["view"], created_by="admin")
    # Assign only VM 999 with view-only – operator should still be able to start VM 100
    await create_assignment(user["id"], "vm", 999, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_operator.post("/api/vms/100/start", headers=_op_headers())

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_viewer_without_assignments_cannot_start_vm(client_with_viewer):
    """Viewer without assignments gets 403 on all mutation endpoints."""
    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_viewer.post("/api/vms/100/start", headers=_viewer_headers())

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_with_start_permission_can_start_assigned_vm(client_with_viewer):
    """Viewer with start permission on VM 100 can start it."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_viewer")
    preset = await create_preset("StartStop", "", ["view", "start", "stop"], created_by="admin")
    await create_assignment(user["id"], "vm", 100, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_viewer.post("/api/vms/100/start", headers=_viewer_headers())

    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_viewer_with_view_only_preset_cannot_start_vm(client_with_viewer):
    """Viewer with view-only preset gets 403 when trying to start the assigned VM."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_viewer")
    preset = await create_preset("ViewOnly", "", ["view"], created_by="admin")
    await create_assignment(user["id"], "vm", 100, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_viewer.post("/api/vms/100/start", headers=_viewer_headers())

    assert resp.status_code == 403
    assert "start" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_viewer_cannot_start_unassigned_vm(client_with_viewer):
    """Viewer with RBAC configured gets 403 for VMs not in their assignment list."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_viewer")
    preset = await create_preset("Full", "", ["view", "start", "stop"], created_by="admin")
    # Assign VM 999, NOT VM 100
    await create_assignment(user["id"], "vm", 999, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_viewer.post("/api/vms/100/start", headers=_viewer_headers())

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_with_view_only_cannot_take_snapshot(client_with_viewer):
    """Viewer with view-only preset gets 403 on snapshot operations."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_viewer")
    preset = await create_preset("ViewOnly2", "", ["view"], created_by="admin")
    await create_assignment(user["id"], "vm", 100, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch("backend.routers.vms.proxmox_client.get_snapshots", new=AsyncMock(return_value=[])),
    ):
        resp = await client_with_viewer.get("/api/vms/100/snapshots", headers=_viewer_headers())

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_restricted_without_assignments_cannot_start_vm(client_with_restricted):
    """Restricted without assignments gets 403 on all mutation endpoints."""
    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_restricted.post("/api/vms/200/start", headers=_restricted_headers())

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_restricted_with_start_permission_can_start_assigned_vm(client_with_restricted):
    """Restricted user with start permission on VM 200 can start it."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_restricted")
    preset = await create_preset("Projekt1", "", ["view", "start", "stop"], created_by="admin")
    await create_assignment(user["id"], "vm", 200, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        resp = await client_with_restricted.post("/api/vms/200/start", headers=_restricted_headers())

    assert resp.status_code == 200
    assert resp.json()["task_id"] == _FAKE_UPID


@pytest.mark.asyncio
async def test_restricted_cannot_start_unassigned_vm(client_with_restricted):
    """Restricted user cannot start a VM not in their assignment list."""
    from backend.services.rbac_service import create_preset, create_assignment
    from backend.services.local_auth import get_user_by_username

    user = await get_user_by_username("rbac_restricted")
    preset = await create_preset("Projekt1b", "", ["view", "start"], created_by="admin")
    await create_assignment(user["id"], "vm", 200, preset.id, created_by="admin")

    with (
        _PATCH_VM_AUTH(),
        patch(
            "backend.routers.vms.proxmox_client.vm_power_action",
            new=AsyncMock(return_value=_FAKE_UPID),
        ),
    ):
        # Try VM 100 which is NOT assigned
        resp = await client_with_restricted.post("/api/vms/100/start", headers=_restricted_headers())

    assert resp.status_code == 403
