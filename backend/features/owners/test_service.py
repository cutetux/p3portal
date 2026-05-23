# p3portal.org
"""PROJ-48: Tests für backend/features/owners/service.py."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from backend.features.owners.schemas import (
    OwnerEntry,
    OwnerListResponse,
    AddCoOwnerRequest,
    TransferOwnerRequest,
    BulkOwnerRequest,
    BulkOwnerItem,
    MyResourceEntry,
)
from backend.features.owners.service import (
    LimitExceededError,
    DuplicateOwnerError,
    LastOwnerError,
)


# ── Schema-Tests (Pydantic-Konstruktion) ─────────────────────────────────────

class TestOwnerEntrySchema:
    def test_valid_entry(self):
        entry = OwnerEntry(
            id=1,
            resource_type="vm",
            node_id=2,
            vmid=100,
            user_id=5,
            assigned_at="2026-01-01T00:00:00+00:00",
            source="deploy",
        )
        assert entry.resource_type == "vm"
        assert entry.vmid == 100
        assert entry.username is None

    def test_full_entry(self):
        entry = OwnerEntry(
            id=1,
            resource_type="lxc",
            node_id=2,
            vmid=200,
            user_id=5,
            username="testuser",
            assigned_at="2026-01-01T00:00:00+00:00",
            assigned_by_user_id=1,
            assigned_by_username="admin",
            source="adopt",
        )
        assert entry.username == "testuser"
        assert entry.assigned_by_username == "admin"


class TestOwnerListResponse:
    def test_empty(self):
        resp = OwnerListResponse(owners=[])
        assert resp.owners == []

    def test_with_entries(self):
        entry = OwnerEntry(
            id=1, resource_type="vm", node_id=1, vmid=100,
            user_id=1, assigned_at="2026-01-01T00:00:00+00:00", source="deploy",
        )
        resp = OwnerListResponse(owners=[entry])
        assert len(resp.owners) == 1


class TestBulkOwnerRequest:
    def test_valid(self):
        req = BulkOwnerRequest(resources=[
            BulkOwnerItem(resource_type="vm", node_id=1, vmid=100),
            BulkOwnerItem(resource_type="lxc", node_id=1, vmid=200),
        ])
        assert len(req.resources) == 2

    def test_too_many_resources(self):
        with pytest.raises(Exception):
            BulkOwnerRequest(resources=[
                BulkOwnerItem(resource_type="vm", node_id=1, vmid=i)
                for i in range(501)
            ])


class TestAddCoOwnerRequest:
    def test_valid(self):
        req = AddCoOwnerRequest(user_id=5)
        assert req.user_id == 5


class TestTransferOwnerRequest:
    def test_valid(self):
        req = TransferOwnerRequest(to_user_id=7)
        assert req.to_user_id == 7


# ── Custom-Exception Tests ─────────────────────────────────────────────────────

class TestCustomExceptions:
    def test_limit_exceeded_error(self):
        exc = LimitExceededError("Limit erreicht")
        assert "Limit" in str(exc)
        assert isinstance(exc, Exception)

    def test_duplicate_owner_error(self):
        exc = DuplicateOwnerError("Bereits Owner")
        assert "Bereits" in str(exc)

    def test_last_owner_error(self):
        exc = LastOwnerError("Letzter Owner")
        assert "Letzter" in str(exc)


# ── Service-Function Tests (mit DB-Mocking) ────────────────────────────────────

@pytest.mark.asyncio
class TestCountActiveOwnerships:
    async def test_count_returns_zero_when_empty(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar.return_value = 0
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.service.get_db", return_value=mock_ctx):
            from backend.features.owners.service import count_active_ownerships
            count = await count_active_ownerships(user_id=1)
        assert count == 0

    async def test_count_returns_value(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar.return_value = 3
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.service.get_db", return_value=mock_ctx):
            from backend.features.owners.service import count_active_ownerships
            count = await count_active_ownerships(user_id=1)
        assert count == 3


@pytest.mark.asyncio
class TestCountActiveOwnershipsGlobally:
    async def test_global_count(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar.return_value = 7
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.service.get_db", return_value=mock_ctx):
            from backend.features.owners.service import count_active_ownerships_globally
            count = await count_active_ownerships_globally()
        assert count == 7


@pytest.mark.asyncio
class TestIsOwner:
    async def test_is_owner_true(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = (1,)
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.service.get_db", return_value=mock_ctx):
            from backend.features.owners.service import is_owner
            result = await is_owner("vm", 1, 100, 5)
        assert result is True

    async def test_is_owner_false(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.fetchone.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.service.get_db", return_value=mock_ctx):
            from backend.features.owners.service import is_owner
            result = await is_owner("vm", 1, 100, 5)
        assert result is False


@pytest.mark.asyncio
class TestCountActiveOwners:
    async def test_count_active_owners(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar.return_value = 2
        mock_session.execute = AsyncMock(return_value=mock_result)

        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_session)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("backend.features.owners.service.get_db", return_value=mock_ctx):
            from backend.features.owners.service import count_active_owners
            count = await count_active_owners("vm", 1, 100)
        assert count == 2


# ── MyResourceEntry-Schema Test ────────────────────────────────────────────────

class TestMyResourceEntry:
    def test_valid(self):
        entry = MyResourceEntry(
            id=1,
            resource_type="vm",
            node_id=1,
            node_name="pve-node1",
            vmid=100,
            assigned_at="2026-01-01T00:00:00+00:00",
            source="deploy",
        )
        assert entry.node_name == "pve-node1"
        assert entry.source == "deploy"
