# p3portal.org
from __future__ import annotations

import io
import zipfile
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.packer import router
from backend.services.service_accounts import TokenConfig

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer@pam", role="viewer")
_OPERATOR_TOKEN = create_access_token("operator@pam", role="operator")
_PROXMOX_OPERATOR_TOKEN = create_access_token("operator@pam", auth_type="proxmox", role="operator")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
# Local-auth tokens for build tests (service-account token path)
_LOCAL_OPERATOR_TOKEN = create_access_token("operator", auth_type="local", role="operator")
_LOCAL_ADMIN_TOKEN = create_access_token("admin-local", auth_type="local", role="admin")

_MOCK_TOKEN = TokenConfig(token_id="packer@pve!token", token_secret="secret")
_MOCK_TOKEN_RETURN = (_MOCK_TOKEN, "https://proxmox.test:8006", True)
_NO_TOKEN_RETURN = (None, "https://proxmox.test:8006", True)


@pytest.fixture(autouse=True)
def mock_node_tokens():
    """Default: per-node packer token available. Tests that want missing-token behaviour
    should patch backend.routers.packer.get_node_tokens to return _NO_TOKEN_RETURN."""
    with patch(
        "backend.routers.packer.get_node_tokens",
        new=AsyncMock(return_value=_MOCK_TOKEN_RETURN),
    ):
        yield


_META_YAML = b"""\
name: "Test Template"
description: "A test packer template"
required_role: "operator"
parameters:
  - id: vm_id
    label: "VM ID"
    type: integer
    required: true
    min: 100
  - id: node
    label: "Node"
    type: string
    required: true
"""

_HCL_CONTENT = b'variable "proxmox_api_url" { type = string }\nsource "proxmox-iso" "test" {}\nbuild { sources = ["source.proxmox-iso.test"] }\n'


def _make_zip(
    hcl_name: str,
    hcl_content: bytes,
    meta_content: bytes,
    extra: dict[str, bytes] | None = None,
    wrapped: bool = False,
) -> bytes:
    """Create an in-memory ZIP suitable for upload tests."""
    buf = io.BytesIO()
    prefix = hcl_name[: -len(".pkr.hcl")] + "/" if wrapped else ""
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(prefix + hcl_name, hcl_content)
        zf.writestr(prefix + "meta.yaml", meta_content)
        for name, data in (extra or {}).items():
            zf.writestr(prefix + name, data)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest.fixture
def packer_dir(tmp_path, monkeypatch):
    pdir = tmp_path / "packer"
    pdir.mkdir()
    tdir = pdir / "test-template"
    tdir.mkdir()
    (tdir / "test.pkr.hcl").write_bytes(_HCL_CONTENT)
    (tdir / "meta.yaml").write_bytes(_META_YAML)
    from backend.core.config import settings
    monkeypatch.setattr(settings, "packer_dir", str(pdir))
    return pdir


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Auth guards ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_templates_unauthorized(client: AsyncClient):
    resp = await client.get("/api/packer")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_build_start_viewer_forbidden(client: AsyncClient, packer_dir):
    resp = await client.post(
        "/api/packer/test-template/build",
        json={"params": {"vm_id": 100, "node": "pve"}},
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_upload_operator_forbidden(client: AsyncClient, packer_dir):
    zip_content = _make_zip("new.pkr.hcl", _HCL_CONTENT, _META_YAML)
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("new.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_delete_operator_forbidden(client: AsyncClient, packer_dir):
    resp = await client.delete(
        "/api/packer/test-template",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 403


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_templates_success(client: AsyncClient, packer_dir):
    resp = await client.get("/api/packer", headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["id"] == "test-template"
    assert body[0]["name"] == "Test Template"
    assert body[0]["required_role"] == "operator"


@pytest.mark.asyncio
async def test_list_templates_empty(client: AsyncClient, tmp_path, monkeypatch):
    from backend.core.config import settings
    empty = tmp_path / "empty_packer"
    empty.mkdir()
    monkeypatch.setattr(settings, "packer_dir", str(empty))
    resp = await client.get("/api/packer", headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"})
    assert resp.status_code == 200
    assert resp.json() == []


# ── Detail ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_template_detail_success(client: AsyncClient, packer_dir):
    resp = await client.get(
        "/api/packer/test-template",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == "test-template"
    assert len(body["parameters"]) == 2
    param_ids = {p["id"] for p in body["parameters"]}
    assert param_ids == {"vm_id", "node"}


@pytest.mark.asyncio
async def test_get_template_detail_not_found(client: AsyncClient, packer_dir):
    resp = await client.get(
        "/api/packer/nonexistent",
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 404


# ── Build start ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_build_start_success(client: AsyncClient, packer_dir):
    with patch("backend.routers.packer.run_packer_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/packer/test-template/build",
            json={"params": {"vm_id": 200, "node": "pve"}},
            headers={"Authorization": f"Bearer {_LOCAL_OPERATOR_TOKEN}"},
        )

    assert resp.status_code == 201
    body = resp.json()
    assert body["type"] == "packer"
    assert body["playbook"] == "test-template"
    assert body["status"] == "pending"
    assert body["username"] == "operator"


@pytest.mark.asyncio
async def test_build_start_missing_credentials(client: AsyncClient, packer_dir):
    with patch("backend.routers.packer.get_node_tokens", new=AsyncMock(return_value=_NO_TOKEN_RETURN)):
        resp = await client.post(
            "/api/packer/test-template/build",
            json={"params": {"vm_id": 200, "node": "pve"}},
            headers={"Authorization": f"Bearer {_LOCAL_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 422
    assert "Credentials" in resp.json()["detail"] or "credentials" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_build_start_missing_required_param(client: AsyncClient, packer_dir, monkeypatch):
    # Ein Default-Node muss auflösbar sein, damit der Packer-Token-Check durchläuft
    # und der Endpoint die meta.yaml-Param-Validierung erreicht (der Pfad, den dieser
    # Test prüft). Ohne 'node' UND ohne Default-Node kürzt die Token-Auflösung sonst
    # mit einer Credentials-422 ab, bevor die Param-Prüfung „node fehlt" greift.
    from backend.core.config import settings
    monkeypatch.setattr(settings, "proxmox_node", "pve1")
    resp = await client.post(
        "/api/packer/test-template/build",
        json={"params": {"vm_id": 200}},  # missing 'node'
        headers={"Authorization": f"Bearer {_LOCAL_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 422
    errors = resp.json()["detail"]
    assert any("node" in e for e in errors)


@pytest.mark.asyncio
async def test_build_start_template_not_found(client: AsyncClient, packer_dir, monkeypatch):
    resp = await client.post(
        "/api/packer/nonexistent/build",
        json={"params": {}},
        headers={"Authorization": f"Bearer {_LOCAL_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_build_start_concurrent_block(client: AsyncClient, packer_dir):
    from sqlalchemy import text
    from backend.db.database import get_db
    import uuid
    from datetime import datetime, timezone

    # Insert a fake running job for the same template
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO jobs (id, type, playbook, status, created_at, username, params)
                   VALUES (:id, 'packer', 'test-template', 'running', :ts, 'someone', '{}')"""
            ),
            {"id": str(uuid.uuid4()), "ts": datetime.now(timezone.utc).isoformat()},
        )
        await session.commit()

    with patch("backend.routers.packer.run_packer_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/packer/test-template/build",
            json={"params": {"vm_id": 200, "node": "pve"}},
            headers={"Authorization": f"Bearer {_LOCAL_OPERATOR_TOKEN}"},
        )

    assert resp.status_code == 409


# ── Upload ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_success(client: AsyncClient, packer_dir):
    new_meta = b"name: 'Ubuntu 24'\ndescription: 'Ubuntu 24.04 LTS'\nrequired_role: operator\n"
    zip_content = _make_zip("ubuntu-24.pkr.hcl", _HCL_CONTENT, new_meta)
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("ubuntu-24.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["id"] == "ubuntu-24"
    assert body["name"] == "Ubuntu 24"

    list_resp = await client.get("/api/packer", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    ids = [t["id"] for t in list_resp.json()]
    assert "ubuntu-24" in ids


@pytest.mark.asyncio
async def test_upload_success_wrapped_zip(client: AsyncClient, packer_dir):
    """ZIP with a single top-level directory wrapper."""
    new_meta = b"name: 'Debian 12'\ndescription: 'Debian 12 LTS'\nrequired_role: operator\n"
    zip_content = _make_zip("debian-12.pkr.hcl", _HCL_CONTENT, new_meta, wrapped=True)
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("debian-12.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == "debian-12"


@pytest.mark.asyncio
async def test_upload_success_with_extra_files(client: AsyncClient, packer_dir):
    """ZIP may include http/ and files/ subdirectories."""
    new_meta = b"name: 'Rocky 9'\ndescription: 'Rocky Linux 9'\nrequired_role: operator\n"
    zip_content = _make_zip(
        "rocky-9.pkr.hcl",
        _HCL_CONTENT,
        new_meta,
        extra={
            "http/kickstart.cfg": b"# kickstart",
            "files/cloud.cfg": b"# cloud",
            "description.md": b"# Rocky 9",
        },
    )
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("rocky-9.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 201
    assert resp.json()["id"] == "rocky-9"
    # Extra files should be present on disk
    from backend.core.config import settings
    tdir = packer_dir / "rocky-9"
    assert (tdir / "http" / "kickstart.cfg").exists()
    assert (tdir / "files" / "cloud.cfg").exists()
    assert (tdir / "description.md").exists()


@pytest.mark.asyncio
async def test_upload_not_a_zip(client: AsyncClient, packer_dir):
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("ubuntu.hcl", _HCL_CONTENT, "application/octet-stream")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_missing_hcl(client: AsyncClient, packer_dir):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("meta.yaml", _META_YAML)
    zip_content = buf.getvalue()
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("bad.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_missing_meta(client: AsyncClient, packer_dir):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("ubuntu-24.pkr.hcl", _HCL_CONTENT)
    zip_content = buf.getvalue()
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("bad.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_invalid_meta_yaml(client: AsyncClient, packer_dir):
    zip_content = _make_zip("valid.pkr.hcl", _HCL_CONTENT, b"name: missing_description")
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("bad.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_upload_duplicate_name(client: AsyncClient, packer_dir):
    zip_content = _make_zip("test-template.pkr.hcl", _HCL_CONTENT, _META_YAML)
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("test-template.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_upload_path_traversal_rejected(client: AsyncClient, packer_dir):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("valid.pkr.hcl", _HCL_CONTENT)
        zf.writestr("meta.yaml", _META_YAML)
        zf.writestr("../evil.sh", b"rm -rf /")
    zip_content = buf.getvalue()
    resp = await client.post(
        "/api/packer/upload",
        files={"zip_file": ("evil.zip", zip_content, "application/zip")},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 422


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_success(client: AsyncClient, packer_dir):
    resp = await client.delete(
        "/api/packer/test-template",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 204

    # Should be gone from list
    list_resp = await client.get("/api/packer", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert list_resp.json() == []


@pytest.mark.asyncio
async def test_delete_not_found(client: AsyncClient, packer_dir):
    resp = await client.delete(
        "/api/packer/nonexistent",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_while_running(client: AsyncClient, packer_dir):
    from sqlalchemy import text
    from backend.db.database import get_db
    import uuid
    from datetime import datetime, timezone

    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO jobs (id, type, playbook, status, created_at, username, params)
                   VALUES (:id, 'packer', 'test-template', 'running', :ts, 'someone', '{}')"""
            ),
            {"id": str(uuid.uuid4()), "ts": datetime.now(timezone.utc).isoformat()},
        )
        await session.commit()

    resp = await client.delete(
        "/api/packer/test-template",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert resp.status_code == 409


# ── PROJ-13: Nodes ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_nodes_unauthorized(client: AsyncClient):
    resp = await client.get("/api/packer/nodes")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_nodes_viewer_forbidden(client: AsyncClient):
    resp = await client.get(
        "/api/packer/nodes",
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_nodes_core_returns_config_node(client: AsyncClient, monkeypatch):
    """Core edition: /packer/nodes returns the configured PROXMOX_NODE, no credentials needed."""
    from backend.core.config import settings
    monkeypatch.setattr(settings, "proxmox_node", "pve1")
    with patch("backend.core.plus_protocol.is_plus_edition", return_value=False):
        resp = await client.get(
            "/api/packer/nodes",
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "pve1"
    assert body[0]["status"] == "online"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_missing_credentials(client: AsyncClient):
    """Plus edition: no viewer credentials → 503."""
    from fastapi import HTTPException as FastHTTPException
    from fastapi import status as fstatus
    with (
        patch(
            "backend.routers.packer._get_viewer_auth_for_packer",
            new=AsyncMock(side_effect=FastHTTPException(
                status_code=fstatus.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Viewer service account not configured",
            )),
        ),
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
    ):
        resp = await client.get(
            "/api/packer/nodes",
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 503


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_success(client: AsyncClient):
    """Plus edition, proxmox user: returns cluster nodes via session cookie."""
    from unittest.mock import MagicMock
    mock_resources = [
        {"node": "pve1", "status": "online", "type": "node"},
        {"node": "pve2", "status": "online", "type": "node"},
    ]
    mock_client = MagicMock()
    mock_client.get_cluster_resources_v2 = AsyncMock(return_value=mock_resources)
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch(
            "backend.routers.packer._get_viewer_auth_for_packer",
            new=AsyncMock(return_value=(MagicMock(), mock_client)),
        ),
    ):
        resp = await client.get(
            "/api/packer/nodes",
            headers={"Authorization": f"Bearer {_PROXMOX_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["name"] == "pve1"
    assert body[0]["status"] == "online"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_success_local_fanout(client: AsyncClient):
    """Plus edition, local user: fan-out across all portal nodes."""
    from unittest.mock import MagicMock
    from backend.services.nodes_service import NodeRow
    mock_node = MagicMock(spec=NodeRow)
    mock_node.url = "https://proxmox.test:8006"
    mock_node.verify_ssl = True
    mock_resources = [
        {"node": "pve1", "status": "online", "type": "node"},
        {"node": "pve2", "status": "online", "type": "node"},
    ]
    mock_client_instance = MagicMock()
    mock_client_instance.get_cluster_resources_v2 = AsyncMock(return_value=mock_resources)
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch("backend.routers.packer.list_nodes", new=AsyncMock(return_value=[mock_node])),
        patch("backend.routers.packer._extract_token", return_value=_MOCK_TOKEN),
        patch("backend.routers.packer.ProxmoxClient", return_value=mock_client_instance),
    ):
        resp = await client.get(
            "/api/packer/nodes",
            headers={"Authorization": f"Bearer {_LOCAL_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["name"] == "pve1"


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_nodes_proxmox_error(client: AsyncClient):
    """Plus edition, proxmox user: Proxmox API error → 502."""
    from unittest.mock import MagicMock
    mock_client = MagicMock()
    mock_client.get_cluster_resources_v2 = AsyncMock(side_effect=Exception("connection refused"))
    with (
        patch("backend.core.plus_protocol.is_plus_edition", return_value=True),
        patch(
            "backend.routers.packer._get_viewer_auth_for_packer",
            new=AsyncMock(return_value=(MagicMock(), mock_client)),
        ),
    ):
        resp = await client.get(
            "/api/packer/nodes",
            headers={"Authorization": f"Bearer {_PROXMOX_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 502


# ── PROJ-13: ISOs ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_isos_unauthorized(client: AsyncClient):
    resp = await client.get("/api/packer/isos?node=pve")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_get_isos_success(client: AsyncClient):
    mock_isos = [
        {"filename": "debian-13.iso", "volid": "local:iso/debian-13.iso", "size": 400000000},
    ]
    with patch("backend.routers.packer.get_isos", new=AsyncMock(return_value=mock_isos)):
        resp = await client.get(
            "/api/packer/isos?node=pve",
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["filename"] == "debian-13.iso"
    assert body[0]["volid"] == "local:iso/debian-13.iso"


@pytest.mark.asyncio
async def test_get_isos_proxmox_error(client: AsyncClient):
    with patch("backend.routers.packer.get_isos", new=AsyncMock(side_effect=Exception("node offline"))):
        resp = await client.get(
            "/api/packer/isos?node=pve",
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 502


# ── PROJ-13: Query URL ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_query_url_unauthorized(client: AsyncClient):
    resp = await client.post("/api/packer/isos/query-url", json={"url": "https://example.com/a.iso"})
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_query_url_success(client: AsyncClient):
    mock_result = {"filename": "debian-13.iso", "size": 400000000, "content_type": "application/x-iso9660-image"}
    with patch("backend.routers.packer.query_url", new=AsyncMock(return_value=mock_result)):
        resp = await client.post(
            "/api/packer/isos/query-url",
            json={"url": "https://example.com/debian-13.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "debian-13.iso"
    assert body["size"] == 400000000


@pytest.mark.asyncio
async def test_query_url_invalid_scheme(client: AsyncClient):
    resp = await client.post(
        "/api/packer/isos/query-url",
        json={"url": "ftp://example.com/debian.iso"},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_query_url_unreachable(client: AsyncClient):
    with patch("backend.routers.packer.query_url", new=AsyncMock(side_effect=Exception("timeout"))):
        resp = await client.post(
            "/api/packer/isos/query-url",
            json={"url": "https://example.com/debian.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 502


# ── PROJ-13: ISO Download ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_iso_download_unauthorized(client: AsyncClient):
    resp = await client.post("/api/packer/isos/download", json={
        "node": "pve", "filename": "debian.iso", "url": "https://example.com/debian.iso"
    })
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_iso_download_viewer_forbidden(client: AsyncClient):
    resp = await client.post(
        "/api/packer/isos/download",
        json={"node": "pve", "filename": "debian.iso", "url": "https://example.com/debian.iso"},
        headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_iso_download_success(client: AsyncClient):
    with patch("backend.routers.packer.check_iso_exists", new=AsyncMock(return_value=False)), \
         patch("backend.routers.packer.start_iso_download", new=AsyncMock(return_value="UPID:pve:abc")), \
         patch("backend.routers.packer.run_iso_download_job", new=AsyncMock(return_value=None)):
        resp = await client.post(
            "/api/packer/isos/download",
            json={"node": "pve", "filename": "debian-13.iso", "url": "https://example.com/debian-13.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 201
    body = resp.json()
    assert body["type"] == "iso_download"
    assert body["playbook"] == "debian-13.iso"
    assert body["status"] == "pending"


@pytest.mark.asyncio
async def test_iso_download_already_exists(client: AsyncClient):
    with patch("backend.routers.packer.check_iso_exists", new=AsyncMock(return_value=True)):
        resp = await client.post(
            "/api/packer/isos/download",
            json={"node": "pve", "filename": "debian-13.iso", "url": "https://example.com/debian-13.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 409
    assert "existiert bereits" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_iso_download_invalid_filename(client: AsyncClient):
    with patch("backend.routers.packer.check_iso_exists", new=AsyncMock(return_value=False)):
        resp = await client.post(
            "/api/packer/isos/download",
            json={"node": "pve", "filename": "../evil.iso", "url": "https://example.com/evil.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_iso_download_invalid_url_scheme(client: AsyncClient):
    with patch("backend.routers.packer.check_iso_exists", new=AsyncMock(return_value=False)):
        resp = await client.post(
            "/api/packer/isos/download",
            json={"node": "pve", "filename": "debian.iso", "url": "ftp://example.com/debian.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_iso_download_missing_credentials(client: AsyncClient):
    with patch("backend.routers.packer.get_node_tokens", new=AsyncMock(return_value=_NO_TOKEN_RETURN)):
        resp = await client.post(
            "/api/packer/isos/download",
            json={"node": "pve", "filename": "debian.iso", "url": "https://example.com/debian.iso"},
            headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
        )
    assert resp.status_code == 422
