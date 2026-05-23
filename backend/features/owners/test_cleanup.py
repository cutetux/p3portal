# p3portal.org
"""PROJ-48: Tests für backend/features/owners/cleanup.py."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
class TestCountActiveOwnershipsForUser:
    async def test_returns_count(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar.return_value = 4
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.cleanup.get_db", return_value=mock_ctx):
            from backend.features.owners.cleanup import count_active_ownerships_for_user
            count = await count_active_ownerships_for_user(user_id=1)
        assert count == 4


@pytest.mark.asyncio
class TestOnUserDelete:
    async def test_orphan_action_marks_entries(self):
        mock_session = AsyncMock()
        # First call: SELECT list of entries
        mock_result_entries = MagicMock()
        mock_result_entries.fetchall.return_value = [(1, "vm", 1, 100)]
        # Second call: UPDATE
        mock_result_update = MagicMock()

        mock_session.execute = AsyncMock(side_effect=[
            mock_result_entries,
            mock_result_update,
        ])
        mock_session.commit = AsyncMock()

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.cleanup.get_db", return_value=mock_ctx), \
             patch("backend.features.owners.cleanup.write_audit_log", new_callable=AsyncMock):
            from backend.features.owners.cleanup import on_user_delete
            await on_user_delete(user_id=5, actor_username="admin", action="orphan")

        # Should have called execute at least once
        assert mock_session.execute.call_count >= 1

    async def test_transfer_requires_target(self):
        from backend.features.owners.cleanup import on_user_delete
        with pytest.raises(ValueError, match="transfer_to_user_id"):
            await on_user_delete(user_id=5, actor_username="admin", action="transfer", transfer_to_user_id=None)


@pytest.mark.asyncio
class TestReconcileForNode:
    async def test_no_owned_vms_no_action(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.cleanup.get_db", return_value=mock_ctx):
            from backend.features.owners.cleanup import reconcile_for_node
            # Should complete without error
            await reconcile_for_node(node_id=1, raw_vms=[{"vmid": 100}, {"vmid": 200}])

        mock_session.execute.assert_called_once()

    async def test_missing_vm_triggers_soft_delete(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        # VM 999 is owned but NOT in the fresh snapshot
        mock_result.fetchall.return_value = [("vm", 999)]
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.cleanup.get_db", return_value=mock_ctx), \
             patch("backend.features.owners.cleanup.on_resource_deleted", new_callable=AsyncMock) as mock_delete:
            from backend.features.owners.cleanup import reconcile_for_node
            await reconcile_for_node(node_id=1, raw_vms=[{"vmid": 100}])

        mock_delete.assert_called_once_with("vm", 1, 999, actor_username="cluster_refresh")

    async def test_existing_vm_not_deleted(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        # VM 100 is owned AND still in the snapshot
        mock_result.fetchall.return_value = [("vm", 100)]
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.cleanup.get_db", return_value=mock_ctx), \
             patch("backend.features.owners.cleanup.on_resource_deleted", new_callable=AsyncMock) as mock_delete:
            from backend.features.owners.cleanup import reconcile_for_node
            await reconcile_for_node(node_id=1, raw_vms=[{"vmid": 100}, {"vmid": 200}])

        mock_delete.assert_not_called()


@pytest.mark.asyncio
class TestOnNodeDelete:
    async def test_no_entries_skips(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchall.return_value = []
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.cleanup.get_db", return_value=mock_ctx):
            from backend.features.owners.cleanup import on_node_delete
            await on_node_delete(node_id=99, actor_username="admin")

        # No UPDATE call because no entries
        assert mock_session.execute.call_count == 1  # Only SELECT
