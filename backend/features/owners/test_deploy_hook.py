# p3portal.org
"""PROJ-48: Tests für backend/features/owners/deploy_hook.py."""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
class TestOnDeploySuccess:
    async def test_skips_when_job_not_found(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.fetchone.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.deploy_hook.get_db", return_value=mock_ctx):
            from backend.features.owners.deploy_hook import on_deploy_success
            await on_deploy_success("nonexistent-job-id")
        # Should not raise

    async def test_skips_when_no_auto_owner_user_id(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.fetchone.return_value = {
            "auto_owner_user_id": None,
            "deploy_category": "vm_deployment",
            "params": "{}",
            "username": "operator",
        }
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.deploy_hook.get_db", return_value=mock_ctx):
            from backend.features.owners.deploy_hook import on_deploy_success
            await on_deploy_success("job-no-owner")
        # Should not raise, just return

    async def test_skips_when_wrong_deploy_category(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.mappings.return_value.fetchone.return_value = {
            "auto_owner_user_id": 5,
            "deploy_category": "other_category",
            "params": "{}",
            "username": "operator",
        }
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.deploy_hook.get_db", return_value=mock_ctx):
            from backend.features.owners.deploy_hook import on_deploy_success
            await on_deploy_success("job-wrong-category")
        # Should not raise


class TestResolveVmid:
    def test_resolves_vm_id_param(self):
        from backend.features.owners.deploy_hook import _resolve_vmid
        result = _resolve_vmid({"vm_id": "105"})
        assert result == 105

    def test_resolves_vmid_param(self):
        from backend.features.owners.deploy_hook import _resolve_vmid
        result = _resolve_vmid({"vmid": 200})
        assert result == 200

    def test_returns_none_when_no_vmid(self):
        from backend.features.owners.deploy_hook import _resolve_vmid
        result = _resolve_vmid({})
        assert result is None

    def test_returns_none_for_invalid_vmid(self):
        from backend.features.owners.deploy_hook import _resolve_vmid
        result = _resolve_vmid({"vm_id": "not-a-number"})
        assert result is None


@pytest.mark.asyncio
class TestResolveNodeId:
    async def test_returns_none_when_no_proxmox_node_in_params(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.deploy_hook.get_db", return_value=mock_ctx):
            from backend.features.owners.deploy_hook import _resolve_node_id
            result = await _resolve_node_id({})
        assert result is None

    async def test_resolves_node_by_proxmox_node_name(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (7,)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.deploy_hook.get_db", return_value=mock_ctx):
            from backend.features.owners.deploy_hook import _resolve_node_id
            result = await _resolve_node_id({"proxmox_node": "pve-node1"})
        assert result == 7


# ── DEPLOY_CATEGORIES Konstante ────────────────────────────────────────────────

def test_deploy_categories_contains_vm_and_lxc():
    from backend.features.owners.deploy_hook import DEPLOY_CATEGORIES
    assert "vm_deployment" in DEPLOY_CATEGORIES
    assert "lxc_deployment" in DEPLOY_CATEGORIES
    assert "other" not in DEPLOY_CATEGORIES
