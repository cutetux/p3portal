# p3portal.org
"""Tests für PROJ-78 – Backup-Job-Verwaltung (Router + Schemas)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient

from backend.models.vms import (
    BackupRetention,
    BackupSchedule,
    BackupJobCreateRequest,
    BackupJobUpdateRequest,
)

# ── Test fixtures & helpers ───────────────────────────────────────────────────

_ADMIN_USER = MagicMock(
    username="admin",
    auth_type="local",
    role="admin",
    portal_permissions=[],
    jti="jti-admin",
    user_id=1,
)
_VIEWER_USER = MagicMock(
    username="viewer",
    auth_type="local",
    role="viewer",
    portal_permissions=[],
    jti="jti-viewer",
    user_id=2,
)
_MANAGER_USER = MagicMock(
    username="manager",
    auth_type="local",
    role="viewer",
    portal_permissions=["manage_backup_jobs"],
    jti="jti-manager",
    user_id=3,
)

_SAMPLE_JOB = {
    "id": "backup-abc123",
    "schedule": "0 2 * * *",
    "storage": "local",
    "mode": "snapshot",
    "compress": "zstd",
    "enabled": 1,
    "comment": "Nightly backup",
    "all": 1,
}


def _override_admin(app):
    from backend.core.deps import require_admin_or, get_current_user
    app.dependency_overrides[require_admin_or("manage_backup_jobs")] = lambda: _ADMIN_USER
    app.dependency_overrides[get_current_user] = lambda: _ADMIN_USER


def _override_viewer(app):
    from backend.core.deps import require_admin_or, get_current_user
    # require_admin_or should block the viewer
    app.dependency_overrides[get_current_user] = lambda: _VIEWER_USER


def _clear(app):
    app.dependency_overrides.clear()


# ── BackupRetention tests ─────────────────────────────────────────────────────

class TestBackupRetention:
    def test_to_proxmox_param_all_fields(self):
        r = BackupRetention(keep_last=7, keep_daily=5, keep_weekly=4, keep_monthly=3)
        result = r.to_proxmox_param()
        assert "keep-last=7" in result
        assert "keep-daily=5" in result
        assert "keep-weekly=4" in result
        assert "keep-monthly=3" in result

    def test_to_proxmox_param_empty(self):
        r = BackupRetention()
        assert r.to_proxmox_param() is None

    def test_to_proxmox_param_partial(self):
        r = BackupRetention(keep_last=5)
        assert r.to_proxmox_param() == "keep-last=5"

    def test_from_proxmox_param_roundtrip(self):
        original = BackupRetention(keep_last=7, keep_daily=5)
        parsed_back = BackupRetention.from_proxmox_param(original.to_proxmox_param())
        assert parsed_back.keep_last == 7
        assert parsed_back.keep_daily == 5
        assert parsed_back.keep_weekly is None
        assert parsed_back.keep_monthly is None

    def test_from_proxmox_param_none(self):
        r = BackupRetention.from_proxmox_param(None)
        assert r.keep_last is None

    def test_from_proxmox_param_empty_string(self):
        r = BackupRetention.from_proxmox_param("")
        assert r.keep_last is None

    def test_from_proxmox_param_non_string_does_not_raise(self):
        """A non-string prune-backups (PVE version drift) must not raise AttributeError."""
        r = BackupRetention.from_proxmox_param(7)   # int instead of str
        assert isinstance(r, BackupRetention)

    def test_negative_retention_raises(self):
        """BUG-78-2: negative values must be rejected by ge=0 constraint."""
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            BackupRetention(keep_last=-1)
        with pytest.raises(ValidationError):
            BackupRetention(keep_daily=-1)
        with pytest.raises(ValidationError):
            BackupRetention(keep_weekly=-1)
        with pytest.raises(ValidationError):
            BackupRetention(keep_monthly=-1)


# ── BackupJobCreateRequest tests ──────────────────────────────────────────────

class TestBackupJobCreateRequest:
    def test_validate_selection_all_vms_ok(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", all_vms=True
        )
        req.validate_selection()  # no exception

    def test_validate_selection_vmids_ok(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", vmids="100,101"
        )
        req.validate_selection()

    def test_validate_selection_pool_ok(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", pool="production"
        )
        req.validate_selection()

    def test_validate_selection_none_raises(self):
        req = BackupJobCreateRequest(schedule="0 2 * * *", storage="local")
        with pytest.raises(ValueError, match="At least one VM-selection mode"):
            req.validate_selection()

    def test_to_proxmox_params_all_vms(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", all_vms=True,
            mode="snapshot", compress="zstd",
        )
        params = req.to_proxmox_params()
        assert params["all"] == 1
        assert "vmid" not in params
        assert "pool" not in params

    def test_to_proxmox_params_vmids(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", vmids="100,101"
        )
        params = req.to_proxmox_params()
        assert params["vmid"] == "100,101"
        assert "all" not in params

    def test_to_proxmox_params_pool(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", pool="prod"
        )
        params = req.to_proxmox_params()
        assert params["pool"] == "prod"

    def test_to_proxmox_params_with_exclude(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", all_vms=True, exclude="200"
        )
        params = req.to_proxmox_params()
        assert params["all"] == 1
        assert params["exclude"] == "200"

    def test_to_proxmox_params_retention(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", all_vms=True,
            retention=BackupRetention(keep_last=7, keep_daily=5),
        )
        params = req.to_proxmox_params()
        assert "prune-backups" in params
        assert "keep-last=7" in params["prune-backups"]

    def test_to_proxmox_params_no_retention(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", all_vms=True,
        )
        params = req.to_proxmox_params()
        assert "prune-backups" not in params

    def test_to_proxmox_params_enabled_false(self):
        req = BackupJobCreateRequest(
            schedule="0 2 * * *", storage="local", all_vms=True, enabled=False
        )
        params = req.to_proxmox_params()
        assert params["enabled"] == 0


# ── BackupSchedule parse tests ────────────────────────────────────────────────

class TestBackupScheduleParse:
    def test_parse_full_job(self):
        from backend.routers.backup_jobs import _parse_backup_schedule
        raw = {
            "id": "backup-abc",
            "schedule": "0 2 * * *",
            "storage": "local",
            "mode": "snapshot",
            "compress": "zstd",
            "enabled": 1,
            "comment": "test",
            "all": 1,
            "mailto": "admin@example.com",
            "prune-backups": "keep-last=7",
        }
        job = _parse_backup_schedule(raw)
        assert job.id == "backup-abc"
        assert job.all == 1
        assert job.mailto == "admin@example.com"
        assert job.retention is not None
        assert job.retention.keep_last == 7

    def test_parse_minimal_job(self):
        from backend.routers.backup_jobs import _parse_backup_schedule
        raw = {
            "id": "backup-min",
            "schedule": "02:00",
            "storage": "nfs",
            "mode": "stop",
        }
        job = _parse_backup_schedule(raw)
        assert job.id == "backup-min"
        assert job.all is None
        assert job.pool is None
        assert job.retention is not None
        assert job.retention.keep_last is None

    def test_parse_pve_version_type_drift(self):
        """A second node on a different PVE version may return vmid as int and
        enabled as string — the parser must coerce, not raise (regression)."""
        from backend.routers.backup_jobs import _parse_backup_schedule
        raw = {
            "id": "backup-drift",
            "schedule": "02:00",
            "storage": "local",
            "mode": "snapshot",
            "enabled": "0",          # string instead of int
            "vmid": 100,             # int instead of comma-separated string
            "exclude": [101, 102],   # list instead of string
        }
        job = _parse_backup_schedule(raw)
        assert job.id == "backup-drift"
        assert job.enabled is False
        assert job.vmid == "100"
        assert job.exclude == "101,102"


# ── Router endpoint tests ─────────────────────────────────────────────────────

class TestBackupJobsRouter:

    @pytest.mark.asyncio
    async def test_list_returns_jobs(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.list_backup_jobs = AsyncMock(return_value=([_SAMPLE_JOB], False))
        mock_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(mock_client, mock_auth))),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["permission_denied"] is False
        assert data["node_unreachable"] is False
        assert len(data["jobs"]) == 1
        assert data["jobs"][0]["id"] == "backup-abc123"

    @pytest.mark.asyncio
    async def test_list_permission_denied_flag(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.list_backup_jobs = AsyncMock(return_value=([], True))
        mock_auth = MagicMock()

        with patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(mock_client, mock_auth))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["permission_denied"] is True

    @pytest.mark.asyncio
    async def test_list_node_unreachable_on_exception(self):
        from backend.main import app
        _override_admin(app)

        with patch("backend.routers.backup_jobs._resolve_read_auth", side_effect=Exception("connection failed")):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["node_unreachable"] is True

    @pytest.mark.asyncio
    async def test_create_success(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.create_backup_job = AsyncMock(return_value={"id": "backup-new"})
        mock_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_client, mock_auth))),
            patch("backend.routers.backup_jobs.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/backup-jobs?node=pve1",
                    json={
                        "schedule": "0 2 * * *",
                        "storage": "local",
                        "all_vms": True,
                        "mode": "snapshot",
                        "compress": "zstd",
                    },
                )
        _clear(app)
        assert resp.status_code == 201

    @pytest.mark.asyncio
    async def test_create_missing_vm_selection_422(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_client, mock_auth))),
            patch("backend.routers.backup_jobs.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post(
                    "/api/backup-jobs?node=pve1",
                    json={"schedule": "0 2 * * *", "storage": "local"},
                )
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_update_success(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.update_backup_job = AsyncMock()
        mock_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_client, mock_auth))),
            patch("backend.routers.backup_jobs.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.put(
                    "/api/backup-jobs/backup-abc123?node=pve1",
                    json={
                        "schedule": "0 3 * * *",
                        "storage": "local",
                        "all_vms": True,
                        "mode": "snapshot",
                        "compress": "zstd",
                    },
                )
        _clear(app)
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_delete_success(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.delete_backup_job = AsyncMock()
        mock_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_client, mock_auth))),
            patch("backend.routers.backup_jobs.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/backup-jobs/backup-abc123?node=pve1")
        _clear(app)
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_run_now_all_mode_single_node(self):
        from backend.main import app
        _override_admin(app)

        mock_read_client = AsyncMock()
        mock_read_client.list_backup_jobs = AsyncMock(return_value=([_SAMPLE_JOB], False))
        mock_read_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"node": "pve1", "status": "online"},
        ])
        mock_read_auth = MagicMock()

        mock_write_client = AsyncMock()
        mock_write_client.run_backup_now = AsyncMock(return_value="UPID:pve1:00001234::vzdump:root@pam:")
        mock_write_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(mock_read_client, mock_read_auth))),
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_write_client, mock_write_auth))),
            patch("backend.routers.backup_jobs.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/backup-jobs/backup-abc123/run?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["tasks"]) == 1
        assert data["tasks"][0]["node"] == "pve1"

    @pytest.mark.asyncio
    async def test_run_now_vmid_mode_fan_out(self):
        from backend.main import app
        _override_admin(app)

        vmid_job = {**_SAMPLE_JOB, "id": "backup-vmid", "vmid": "100,101"}
        del vmid_job["all"]

        mock_read_client = AsyncMock()
        mock_read_client.list_backup_jobs = AsyncMock(return_value=([vmid_job], False))
        mock_read_client.get_cluster_resources_v2 = AsyncMock(return_value=[
            {"vmid": 100, "node": "pve1"},
            {"vmid": 101, "node": "pve2"},
        ])
        mock_read_auth = MagicMock()

        mock_write_client = AsyncMock()
        mock_write_client.run_backup_now = AsyncMock(return_value="UPID:test")
        mock_write_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(mock_read_client, mock_read_auth))),
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_write_client, mock_write_auth))),
            patch("backend.routers.backup_jobs.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/backup-jobs/backup-vmid/run?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        # Fan-out to 2 nodes (pve1 for vmid 100, pve2 for vmid 101)
        assert len(data["tasks"]) == 2
        nodes = {t["node"] for t in data["tasks"]}
        assert nodes == {"pve1", "pve2"}

    @pytest.mark.asyncio
    async def test_run_now_job_not_found_404(self):
        from backend.main import app
        _override_admin(app)

        mock_read_client = AsyncMock()
        mock_read_client.list_backup_jobs = AsyncMock(return_value=([], False))
        mock_read_auth = MagicMock()
        mock_write_client = AsyncMock()
        mock_write_auth = MagicMock()

        with (
            patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(mock_read_client, mock_read_auth))),
            patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_write_client, mock_write_auth))),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/backup-jobs/nonexistent/run?node=pve1")
        _clear(app)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_list_pools_returns_list(self):
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.get_pools = AsyncMock(return_value=[{"poolid": "production"}, {"poolid": "test"}])
        mock_auth = MagicMock()

        with patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(mock_client, mock_auth))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs/pools?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    @pytest.mark.asyncio
    async def test_list_storages_returns_backup_storages(self):
        """Admin-first chain returns storages from the admin token."""
        from backend.main import app
        _override_admin(app)
        mock_client = AsyncMock()
        mock_client.get_node_backup_storages = AsyncMock(
            return_value=[{"storage": "nas-backup", "type": "cifs"}, {"storage": "local", "type": "dir"}]
        )
        mock_auth = MagicMock()

        with patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(mock_client, mock_auth))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs/storages?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert body[0]["storage"] == "nas-backup"
        mock_client.get_node_backup_storages.assert_awaited_once_with(mock_auth, "pve1")

    @pytest.mark.asyncio
    async def test_list_storages_falls_back_to_viewer_when_admin_empty(self):
        """When the admin token yields no storages, fall back to the viewer token."""
        from backend.main import app
        _override_admin(app)
        admin_client = AsyncMock()
        admin_client.get_node_backup_storages = AsyncMock(return_value=[])  # admin sees nothing
        viewer_client = AsyncMock()
        viewer_client.get_node_backup_storages = AsyncMock(return_value=[{"storage": "local", "type": "dir"}])
        auth = MagicMock()

        with patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(return_value=(admin_client, auth))), \
             patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(return_value=(viewer_client, auth))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs/storages?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["storage"] == "local"

    @pytest.mark.asyncio
    async def test_list_storages_returns_empty_on_error(self):
        from backend.main import app
        _override_admin(app)

        with patch("backend.routers.backup_jobs._resolve_write_auth", AsyncMock(side_effect=Exception("boom"))), \
             patch("backend.routers.backup_jobs._resolve_read_auth", AsyncMock(side_effect=Exception("boom"))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/backup-jobs/storages?node=pve1")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json() == []


class TestBackupWriteHttpExc:
    def test_403_maps_to_403(self):
        from backend.routers.backup_jobs import _backup_write_http_exc
        exc = MagicMock(spec=Exception)
        exc.response = MagicMock()
        exc.response.status_code = 403
        result = _backup_write_http_exc(exc)
        assert result.status_code == 403
        assert "Proxmox privileges" in result.detail

    def test_401_maps_to_502(self):
        from backend.routers.backup_jobs import _backup_write_http_exc
        exc = MagicMock(spec=Exception)
        exc.response = MagicMock()
        exc.response.status_code = 401
        result = _backup_write_http_exc(exc)
        assert result.status_code == 502

    def test_500_passes_through(self):
        from backend.routers.backup_jobs import _backup_write_http_exc
        exc = MagicMock(spec=Exception)
        exc.response = MagicMock()
        exc.response.status_code = 500
        result = _backup_write_http_exc(exc)
        assert result.status_code == 500
