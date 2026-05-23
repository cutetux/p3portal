# p3portal.org
"""PROJ-54: Service-Unit-Tests für das Sidebar-Pins-Modul.

Testet: Position-Auto-Increment, Reorder-Atomarität, Limit-Enforcement
(Core hart, Plus soft+hard), Stale-Detection, Cleanup-Hooks, Label-/Route-Validation.
"""
from __future__ import annotations

import json

import pytest
import pytest_asyncio

from backend.db.database import init_db, get_db
from backend.features.sidebar_pins import service
from backend.features.sidebar_pins.schemas import PinCreateRequest, PinUpdateRequest
from sqlalchemy import text
from datetime import datetime, timezone


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db_ready():
    await init_db()
    yield


async def _seed_user(username: str = "alice", role: str = "operator") -> int:
    import hashlib
    pw_hash = hashlib.sha256(b"testpassword").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, "
                "portal_permissions) VALUES (:u, :pw, :role, 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "role": role, "now": now},
        )
        uid = result.fetchone()[0]
        await db.commit()
    return uid


async def _add_pin(
    user_id: int,
    route: str = "/dashboard",
    pin_kind: str = "other",
    resource_ref: str | None = None,
    is_plus: bool = False,
) -> dict:
    pin, _ = await service.add_pin(
        user_id=user_id,
        username="alice",
        is_plus=is_plus,
        route=route,
        label=None,
        pin_kind=pin_kind,
        resource_ref=resource_ref,
    )
    return pin


# ── Position-Auto-Increment ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_position_starts_at_zero(db_ready):
    uid = await _seed_user()
    pin = await _add_pin(uid, "/dashboard")
    assert pin["position"] == 0


@pytest.mark.asyncio
async def test_position_increments_sequentially(db_ready):
    uid = await _seed_user()
    p1 = await _add_pin(uid, "/dashboard")
    p2 = await _add_pin(uid, "/compute")
    p3 = await _add_pin(uid, "/provisioning")
    assert p1["position"] == 0
    assert p2["position"] == 1
    assert p3["position"] == 2


# ── Duplikat-Schutz ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_duplicate_route_raises_value_error(db_ready):
    uid = await _seed_user()
    await _add_pin(uid, "/dashboard")
    with pytest.raises(ValueError, match="bereits gepinnt"):
        await _add_pin(uid, "/dashboard")


# ── Limit-Enforcement Core ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_core_limit_blocks_at_5(db_ready):
    uid = await _seed_user()

    for i in range(5):
        await _add_pin(uid, f"/route-{i}", is_plus=False)

    with pytest.raises(PermissionError) as exc_info:
        await _add_pin(uid, "/route-extra", is_plus=False)

    detail = json.loads(str(exc_info.value))
    assert detail["detail"] == "pin_limit_reached"
    assert detail["edition"] == "core"
    assert detail["max"] == 5


@pytest.mark.asyncio
async def test_core_limit_allows_exactly_5(db_ready):
    uid = await _seed_user()
    for i in range(5):
        pin = await _add_pin(uid, f"/route-{i}", is_plus=False)
        assert pin["position"] == i


# ── Limit-Enforcement Plus ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_plus_soft_warn_after_10(db_ready):
    uid = await _seed_user()
    warning = None
    for i in range(11):
        _, warning = await service.add_pin(
            user_id=uid,
            username="alice",
            is_plus=True,
            route=f"/route-{i}",
            label=None,
            pin_kind="other",
            resource_ref=None,
        )
    assert warning == "pin_soft_limit"


@pytest.mark.asyncio
async def test_plus_hard_limit_blocks_at_25(db_ready):
    uid = await _seed_user()
    for i in range(25):
        await service.add_pin(
            user_id=uid,
            username="alice",
            is_plus=True,
            route=f"/route-{i}",
            label=None,
            pin_kind="other",
            resource_ref=None,
        )
    with pytest.raises(PermissionError) as exc_info:
        await service.add_pin(
            user_id=uid,
            username="alice",
            is_plus=True,
            route="/route-extra",
            label=None,
            pin_kind="other",
            resource_ref=None,
        )
    detail = json.loads(str(exc_info.value))
    assert detail["detail"] == "pin_hard_limit_reached"


# ── Reorder-Atomarität ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reorder_changes_positions(db_ready):
    uid = await _seed_user()
    p1 = await _add_pin(uid, "/a")
    p2 = await _add_pin(uid, "/b")
    p3 = await _add_pin(uid, "/c")

    pins = await service.reorder_pins(
        user_id=uid,
        username="alice",
        pin_ids=[p3["id"], p1["id"], p2["id"]],
    )
    assert pins[0]["route"] == "/c"
    assert pins[1]["route"] == "/a"
    assert pins[2]["route"] == "/b"
    assert [p["position"] for p in pins] == [0, 1, 2]


@pytest.mark.asyncio
async def test_reorder_mismatch_raises(db_ready):
    uid = await _seed_user()
    p1 = await _add_pin(uid, "/a")
    await _add_pin(uid, "/b")

    with pytest.raises(ValueError) as exc_info:
        await service.reorder_pins(
            user_id=uid,
            username="alice",
            pin_ids=[p1["id"]],  # unvollständig
        )
    detail = json.loads(str(exc_info.value))
    assert detail["detail"] == "reorder_mismatch"


@pytest.mark.asyncio
async def test_reorder_foreign_pin_raises(db_ready):
    uid1 = await _seed_user("alice")
    uid2 = await _seed_user("bob")
    p1 = await _add_pin(uid1, "/a")
    p2 = await _add_pin(uid2, "/b")  # fremder Pin

    with pytest.raises(ValueError):
        await service.reorder_pins(
            user_id=uid1,
            username="alice",
            pin_ids=[p1["id"], p2["id"]],
        )


# ── Label-Update ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_label_sets_custom_label(db_ready):
    uid = await _seed_user()
    pin = await _add_pin(uid, "/dashboard")
    updated = await service.update_pin_label(
        pin_id=pin["id"],
        user_id=uid,
        username="alice",
        label="Mein Dashboard",
    )
    assert updated["label"] == "Mein Dashboard"


@pytest.mark.asyncio
async def test_update_label_cross_user_returns_none(db_ready):
    uid1 = await _seed_user("alice")
    uid2 = await _seed_user("bob")
    pin = await _add_pin(uid1, "/dashboard")
    result = await service.update_pin_label(
        pin_id=pin["id"],
        user_id=uid2,  # falscher User
        username="bob",
        label="Hack",
    )
    assert result is None


# ── Delete ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_pin_compactifies_positions(db_ready):
    uid = await _seed_user()
    p1 = await _add_pin(uid, "/a")
    p2 = await _add_pin(uid, "/b")
    p3 = await _add_pin(uid, "/c")

    deleted = await service.delete_pin(p2["id"], uid, "alice")
    assert deleted is True

    pins = await service.list_pins(uid, "alice", [], is_admin=True, is_plus=False)
    assert [p["route"] for p in pins] == ["/a", "/c"]
    assert [p["position"] for p in pins] == [0, 1]


@pytest.mark.asyncio
async def test_delete_foreign_pin_returns_false(db_ready):
    uid1 = await _seed_user("alice")
    uid2 = await _seed_user("bob")
    pin = await _add_pin(uid1, "/dashboard")
    result = await service.delete_pin(pin["id"], uid2, "bob")
    assert result is False


# ── Stale-Cleanup: Node-Pin ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_node_pin_removed_on_list(db_ready):
    uid = await _seed_user()
    # Pin auf nicht-existierenden Node (resource_ref = "9999")
    async with get_db() as db:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            text(
                "INSERT INTO user_sidebar_pins "
                "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                "VALUES (:uid, '/compute/old-node', NULL, 0, 'node', '9999', :now)"
            ),
            {"uid": uid, "now": now},
        )
        await db.commit()

    pins = await service.list_pins(uid, "alice", [], is_admin=True, is_plus=False)
    assert not any(p["route"] == "/compute/old-node" for p in pins)


# ── Stale-Cleanup: Pool-Pin ohne Plus ────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_pool_pin_removed_when_plus_lost(db_ready):
    uid = await _seed_user()
    async with get_db() as db:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            text(
                "INSERT INTO user_sidebar_pins "
                "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                "VALUES (:uid, '/admin/pools/1', NULL, 0, 'pool', '1', :now)"
            ),
            {"uid": uid, "now": now},
        )
        await db.commit()

    # is_plus=False → Pool-Pin ist stale
    pins = await service.list_pins(uid, "alice", [], is_admin=True, is_plus=False)
    assert not any(p["pin_kind"] == "pool" for p in pins)


# ── Stale-Cleanup: Group-Pin ──────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_group_pin_removed_when_group_deleted(db_ready):
    uid = await _seed_user()
    async with get_db() as db:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            text(
                "INSERT INTO user_sidebar_pins "
                "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                "VALUES (:uid, '/admin/groups/99', NULL, 0, 'group', '99', :now)"
            ),
            {"uid": uid, "now": now},
        )
        await db.commit()

    pins = await service.list_pins(uid, "alice", [], is_admin=True, is_plus=True)
    assert not any(p["pin_kind"] == "group" for p in pins)


# ── Stale-Cleanup: node_tab-Pin ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stale_node_tab_pin_removed_when_node_gone(db_ready):
    uid = await _seed_user()
    async with get_db() as db:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            text(
                "INSERT INTO user_sidebar_pins "
                "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                "VALUES (:uid, '/compute?node=ghost&tab=vms', NULL, 0, 'node_tab', 'ghost', :now)"
            ),
            {"uid": uid, "now": now},
        )
        await db.commit()

    # Node "ghost" existiert nicht in der nodes-Tabelle → stale
    pins = await service.list_pins(uid, "alice", [], is_admin=True, is_plus=False)
    assert not any(p["pin_kind"] == "node_tab" for p in pins)


# ── Resource-Delete-Hook ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cleanup_pins_for_resource(db_ready):
    uid = await _seed_user()
    async with get_db() as db:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            text(
                "INSERT INTO user_sidebar_pins "
                "(user_id, route, label, position, pin_kind, resource_ref, created_at) "
                "VALUES (:uid, '/admin/pools/5', NULL, 0, 'pool', '5', :now)"
            ),
            {"uid": uid, "now": now},
        )
        await db.commit()

    await service.cleanup_pins_for_resource("pool", "5", "admin")

    async with get_db() as db:
        result = await db.execute(
            text("SELECT COUNT(*) FROM user_sidebar_pins WHERE user_id = :uid"),
            {"uid": uid},
        )
        assert result.scalar() == 0


# ── Pydantic-Modelle ──────────────────────────────────────────────────────────

def test_pin_create_request_route_too_long():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PinCreateRequest(route="/" + "a" * 201)


def test_pin_create_request_invalid_route_schema():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PinCreateRequest(route="javascript:alert(1)")


def test_pin_update_request_label_too_long():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PinUpdateRequest(label="x" * 41)


def test_pin_update_request_label_with_html():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        PinUpdateRequest(label="<script>")


def test_pin_update_request_label_empty_becomes_none():
    req = PinUpdateRequest(label="   ")
    assert req.label is None
