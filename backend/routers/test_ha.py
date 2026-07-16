# p3portal.org
"""Tests für PROJ-103 – Proxmox-HA-Verwaltung (Router + Schemas + Parser + Gate + Awareness)."""
from __future__ import annotations

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from backend.models.ha import (
    HaResourceWriteRequest,
    HaRuleWriteRequest,
    HaRuntimeActionRequest,
)

# ── Test users ────────────────────────────────────────────────────────────────

_ADMIN_USER = MagicMock(
    username="admin", auth_type="local", role="admin",
    portal_permissions=[], jti="jti-admin", user_id=1,
)
_VIEWER_USER = MagicMock(
    username="viewer", auth_type="local", role="viewer",
    portal_permissions=[], jti="jti-viewer", user_id=2,
)
_HA_MANAGER = MagicMock(
    username="hamgr", auth_type="local", role="viewer",
    portal_permissions=["manage_ha"], jti="jti-hamgr", user_id=3,
)
_RESTRICTED_USER = MagicMock(
    username="restr", auth_type="local", role="restricted",
    portal_permissions=[], jti="jti-restr", user_id=4,
)

_SAMPLE_RULE = {
    "rule": "rule1", "type": "node-affinity", "resources": "vm:100,ct:101",
    "nodes": "pve1:100,pve2", "strict": 1, "digest": "abc",
}
_SAMPLE_AFFINITY_RULE = {
    "rule": "keep-apart", "type": "resource-affinity", "resources": "vm:100,vm:200",
    "affinity": "negative",
}
_SAMPLE_RESOURCE = {
    "sid": "vm:100", "type": "vm", "state": "started",
    "max_restart": 3, "max_relocate": 1, "failback": 0, "comment": "web",
}
_SAMPLE_STATUS = [
    {"type": "quorum", "quorate": 1, "status": "OK"},
    {"type": "master", "node": "pve1", "status": "active"},
    {"type": "lrm", "node": "pve1", "status": "active"},
    {"type": "lrm", "node": "pve2", "status": "idle"},
    {"type": "service", "sid": "vm:100", "state": "started", "node": "pve1",
     "crm_state": "started", "request_state": "started"},
]


def _override_user(app, user):
    from backend.core.deps import get_current_user, require_not_restricted
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[require_not_restricted] = lambda: user


def _clear(app):
    app.dependency_overrides.clear()


# ── Rule schema validation (PVE 9) ─────────────────────────────────────────────

class TestHaRuleWriteRequest:
    def test_valid_node_affinity(self):
        req = HaRuleWriteRequest(
            rule="rule1", type="node-affinity", resources=["vm:100", "ct:101"],
            nodes=[{"node": "pve1", "priority": 100}, {"node": "pve2"}], strict=True,
        )
        params = req.to_proxmox_params()
        assert params["nodes"] == "pve1:100,pve2"
        assert params["resources"] == "vm:100,ct:101"
        assert params["strict"] == 1
        assert params["disable"] == 0
        assert "affinity" not in params

    def test_valid_resource_affinity(self):
        req = HaRuleWriteRequest(
            rule="keep-apart", type="resource-affinity",
            resources=["vm:100", "vm:200"], affinity="negative",
        )
        params = req.to_proxmox_params()
        assert params["affinity"] == "negative"
        assert params["resources"] == "vm:100,vm:200"
        assert "nodes" not in params

    def test_node_affinity_without_nodes_raises(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="r", type="node-affinity", resources=["vm:100"], nodes=[])

    def test_node_affinity_without_resources_raises(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="r", type="node-affinity", resources=[], nodes=[{"node": "pve1"}])

    def test_resource_affinity_needs_two_resources(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="r", type="resource-affinity", resources=["vm:100"], affinity="positive")

    def test_resource_affinity_needs_affinity(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="r", type="resource-affinity", resources=["vm:100", "vm:200"])

    def test_invalid_type_raises(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="r", type="node-group", resources=["vm:100"], nodes=[{"node": "pve1"}])

    def test_invalid_rule_id_raises(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="1rule", type="node-affinity", resources=["vm:100"], nodes=[{"node": "pve1"}])

    def test_invalid_resource_sid_raises(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(rule="r", type="node-affinity", resources=["100"], nodes=[{"node": "pve1"}])

    def test_duplicate_node_raises(self):
        with pytest.raises(ValidationError):
            HaRuleWriteRequest(
                rule="r", type="node-affinity", resources=["vm:100"],
                nodes=[{"node": "pve1"}, {"node": "pve1"}],
            )

    def test_update_params_omits_rule_and_type(self):
        req = HaRuleWriteRequest(
            rule="rule1", type="node-affinity", resources=["vm:100"], nodes=[{"node": "pve1"}],
        )
        params = req.to_proxmox_params(for_update=True)
        assert "rule" not in params
        assert "type" not in params
        assert params["resources"] == "vm:100"


# ── Resource schema validation ──────────────────────────────────────────────────

class TestHaResourceWriteRequest:
    def test_valid_vm(self):
        req = HaResourceWriteRequest(sid="vm:100", state="started", max_restart=3, failback=False)
        params = req.to_proxmox_params()
        assert params["state"] == "started"
        assert "group" not in params
        assert params["max_restart"] == 3
        assert params["failback"] == 0

    def test_valid_ct(self):
        req = HaResourceWriteRequest(sid="ct:200")
        assert req.sid == "ct:200"
        assert req.state == "started"

    def test_invalid_sid_raises(self):
        with pytest.raises(ValidationError):
            HaResourceWriteRequest(sid="100")
        with pytest.raises(ValidationError):
            HaResourceWriteRequest(sid="qemu:100")

    def test_invalid_state_raises(self):
        with pytest.raises(ValidationError):
            HaResourceWriteRequest(sid="vm:100", state="paused")

    def test_negative_max_restart_raises(self):
        with pytest.raises(ValidationError):
            HaResourceWriteRequest(sid="vm:100", max_restart=-1)

    def test_update_params_keeps_state(self):
        req = HaResourceWriteRequest(sid="vm:100", state="disabled")
        params = req.to_proxmox_params(for_update=True)
        assert params["state"] == "disabled"


class TestHaRuntimeActionRequest:
    def test_valid(self):
        assert HaRuntimeActionRequest(node="pve2").node == "pve2"

    def test_empty_raises(self):
        with pytest.raises(ValidationError):
            HaRuntimeActionRequest(node="  ")


# ── Parsers ──────────────────────────────────────────────────────────────────────

class TestHaParsers:
    def test_parse_node_affinity_rule(self):
        from backend.routers.ha import _parse_ha_rule
        r = _parse_ha_rule(_SAMPLE_RULE)
        assert r.id == "rule1"
        assert r.type == "node-affinity"
        assert r.strict is True
        assert r.resources == ["vm:100", "ct:101"]
        assert len(r.nodes) == 2
        assert r.nodes[0].node == "pve1"
        assert r.nodes[0].priority == 100
        assert r.nodes[1].priority is None

    def test_parse_resource_affinity_rule(self):
        from backend.routers.ha import _parse_ha_rule
        r = _parse_ha_rule(_SAMPLE_AFFINITY_RULE)
        assert r.type == "resource-affinity"
        assert r.affinity == "negative"
        assert r.resources == ["vm:100", "vm:200"]
        assert r.nodes == []

    def test_parse_resource(self):
        from backend.routers.ha import _parse_ha_resource
        r = _parse_ha_resource(_SAMPLE_RESOURCE)
        assert r.sid == "vm:100"
        assert r.type == "vm"
        assert r.state == "started"
        assert r.max_restart == 3
        assert r.failback is False

    def test_parse_resource_strips_service_prefix_and_infers_type(self):
        from backend.routers.ha import _parse_ha_resource
        r = _parse_ha_resource({"sid": "service:ct:200", "state": "stopped"})
        assert r.sid == "ct:200"
        assert r.type == "ct"

    def test_parse_non_dict_does_not_raise(self):
        from backend.routers.ha import _parse_ha_rule, _parse_ha_resource
        assert _parse_ha_rule("x").id == ""  # type: ignore[arg-type]
        assert _parse_ha_resource(None).sid == ""  # type: ignore[arg-type]

    def test_parse_status(self):
        from backend.routers.ha import _parse_status
        s = _parse_status(_SAMPLE_STATUS)
        assert s.quorate is True
        assert s.manager_node == "pve1"
        assert len(s.resources) == 1
        assert s.resources[0].sid == "vm:100"
        assert s.resources[0].node == "pve1"
        # master + 2 lrm
        assert len(s.nodes) == 3

    def test_parse_status_quorum_via_status_field(self):
        from backend.routers.ha import _parse_status
        s = _parse_status([{"type": "quorum", "status": "OK"}])
        assert s.quorate is True
        s2 = _parse_status([{"type": "quorum", "status": "NO"}])
        assert s2.quorate is False

    def test_parse_pve_type_drift(self):
        from backend.routers.ha import _parse_ha_rule
        r = _parse_ha_rule({"rule": "g", "type": "node-affinity", "nodes": "pve1:50", "strict": "1"})
        assert r.strict is True
        assert r.nodes[0].priority == 50


# ── Error mapper ─────────────────────────────────────────────────────────────────

class TestHaWriteHttpExc:
    def _exc(self, code):
        exc = MagicMock(spec=httpx.HTTPStatusError)
        exc.response = MagicMock()
        exc.response.status_code = code
        return exc

    def test_403_maps_to_403(self):
        from backend.routers.ha import _ha_write_http_exc
        result = _ha_write_http_exc(self._exc(403))
        assert result.status_code == 403

    def test_401_maps_to_502(self):
        from backend.routers.ha import _ha_write_http_exc
        assert _ha_write_http_exc(self._exc(401)).status_code == 502

    def test_500_passes_through(self):
        from backend.routers.ha import _ha_write_http_exc
        assert _ha_write_http_exc(self._exc(500)).status_code == 500


# ── RBAC gate ────────────────────────────────────────────────────────────────────

class TestAssertHaAccess:
    def test_admin_allowed(self):
        from backend.routers.ha import _assert_ha_access
        _assert_ha_access(_ADMIN_USER)

    def test_manage_ha_allowed(self):
        from backend.routers.ha import _assert_ha_access
        _assert_ha_access(_HA_MANAGER)

    def test_viewer_denied(self):
        from fastapi import HTTPException
        from backend.routers.ha import _assert_ha_access
        with pytest.raises(HTTPException) as ei:
            _assert_ha_access(_VIEWER_USER)
        assert ei.value.status_code == 403


# ── Read-auth token chain ────────────────────────────────────────────────────────

class TestResolveHaReadAuth:
    @pytest.mark.asyncio
    async def test_prefers_admin_token(self):
        from backend.routers import ha
        node_row = MagicMock(url="https://pve:8006", verify_ssl=False)

        def _extract(row, role):
            return MagicMock(token_id=f"id-{role}", token_secret=f"sec-{role}") if role == "admin" else None

        with (
            patch("backend.services.nodes_service.get_default_node", AsyncMock(return_value=node_row)),
            patch("backend.services.service_accounts._extract_token", side_effect=_extract),
        ):
            client, auth = await ha._resolve_ha_read_auth(_HA_MANAGER)
        assert auth.value == "id-admin"


# ── Status endpoint ─────────────────────────────────────────────────────────────

class TestHaStatusRouter:
    @pytest.mark.asyncio
    async def test_status_viewer_allowed(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mock_client = AsyncMock()
        mock_client.get_ha_status_current = AsyncMock(return_value=_SAMPLE_STATUS)
        with patch("backend.routers.ha._resolve_ha_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ha/status")
        _clear(app)
        assert resp.status_code == 200
        data = resp.json()
        assert data["quorate"] is True
        assert data["manager_node"] == "pve1"
        assert len(data["resources"]) == 1

    @pytest.mark.asyncio
    async def test_status_404_maps_to_ha_unavailable(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mock_client = AsyncMock()
        resp_404 = MagicMock(status_code=404)
        mock_client.get_ha_status_current = AsyncMock(
            side_effect=httpx.HTTPStatusError("nf", request=MagicMock(), response=resp_404)
        )
        with patch("backend.routers.ha._resolve_ha_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ha/status")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["ha_unavailable"] is True

    @pytest.mark.asyncio
    async def test_status_restricted_denied(self):
        from backend.main import app
        # restricted must be blocked by require_not_restricted → don't override it
        from backend.core.deps import get_current_user
        app.dependency_overrides[get_current_user] = lambda: _RESTRICTED_USER
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.get("/api/ha/status")
        _clear(app)
        assert resp.status_code == 403


# ── Rule endpoints (PVE 9) ─────────────────────────────────────────────────────

class TestHaRuleRouter:
    @pytest.mark.asyncio
    async def test_list_rules(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mock_client = AsyncMock()
        mock_client.get_ha_rules = AsyncMock(return_value=[_SAMPLE_RULE, _SAMPLE_AFFINITY_RULE])
        with patch("backend.routers.ha._resolve_ha_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ha/rules")
        _clear(app)
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 2
        assert items[0]["type"] == "node-affinity"
        assert items[1]["affinity"] == "negative"

    @pytest.mark.asyncio
    async def test_list_rules_permission_denied(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mock_client = AsyncMock()
        resp_403 = MagicMock(status_code=403)
        mock_client.get_ha_rules = AsyncMock(
            side_effect=httpx.HTTPStatusError("forbidden", request=MagicMock(), response=resp_403)
        )
        with patch("backend.routers.ha._resolve_ha_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ha/rules")
        _clear(app)
        assert resp.json()["permission_denied"] is True

    @pytest.mark.asyncio
    async def test_list_rules_500_surfaces_proxmox_body(self):
        """BUG-103-3 Diagnose: ein Proxmox-5xx blendet den Fehler-Body ins detail ein."""
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mock_client = AsyncMock()
        resp_500 = MagicMock(status_code=500, text="internal error / permission")
        resp_500.json = MagicMock(side_effect=ValueError("not json"))
        mock_client.get_ha_rules = AsyncMock(
            side_effect=httpx.HTTPStatusError("boom", request=MagicMock(), response=resp_500)
        )
        with patch("backend.routers.ha._resolve_ha_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ha/rules")
        _clear(app)
        body = resp.json()
        assert resp.status_code == 200  # never 500 to the browser
        assert body["cluster_unreachable"] is True
        assert "HTTP 500" in body["detail"]
        assert "permission" in body["detail"]  # Proxmox-Body eingeblendet

    @pytest.mark.asyncio
    async def test_create_node_affinity_rule_success(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_rules = AsyncMock(return_value=[])
        mock_client.create_ha_rule = AsyncMock()
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/rules", json={
                    "rule": "rule1", "type": "node-affinity",
                    "resources": ["vm:100"], "nodes": [{"node": "pve1", "priority": 100}], "strict": True,
                })
        _clear(app)
        assert resp.status_code == 201
        params = mock_client.create_ha_rule.call_args.args[1]
        assert params["rule"] == "rule1"
        assert params["type"] == "node-affinity"
        assert params["nodes"] == "pve1:100"
        assert params["resources"] == "vm:100"
        assert params["strict"] == 1

    @pytest.mark.asyncio
    async def test_create_resource_affinity_rule_success(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_rules = AsyncMock(return_value=[])
        mock_client.create_ha_rule = AsyncMock()
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/rules", json={
                    "rule": "apart", "type": "resource-affinity",
                    "resources": ["vm:100", "vm:200"], "affinity": "negative",
                })
        _clear(app)
        assert resp.status_code == 201
        params = mock_client.create_ha_rule.call_args.args[1]
        assert params["affinity"] == "negative"

    @pytest.mark.asyncio
    async def test_create_rule_invalid_body_422(self):
        """resource-affinity mit nur 1 Ressource → 422 (serverseitige Validierung)."""
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        with patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(AsyncMock(), MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/rules", json={
                    "rule": "apart", "type": "resource-affinity", "resources": ["vm:100"], "affinity": "negative",
                })
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_create_rule_collision_409(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_rules = AsyncMock(return_value=[_SAMPLE_RULE])
        with patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/rules", json={
                    "rule": "rule1", "type": "node-affinity", "resources": ["vm:100"], "nodes": [{"node": "pve1"}],
                })
        _clear(app)
        assert resp.status_code == 409

    @pytest.mark.asyncio
    async def test_create_rule_blocked_for_viewer(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/ha/rules", json={
                "rule": "g", "type": "node-affinity", "resources": ["vm:100"], "nodes": [{"node": "pve1"}],
            })
        _clear(app)
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_delete_rule_success(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.delete_ha_rule = AsyncMock()
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.delete("/api/ha/rules/rule1")
        _clear(app)
        assert resp.status_code == 204
        mock_client.delete_ha_rule.assert_awaited_once()


# ── Resource endpoints ───────────────────────────────────────────────────────────

class TestHaResourceRouter:
    @pytest.mark.asyncio
    async def test_list_resources(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        mock_client = AsyncMock()
        mock_client.get_ha_resources = AsyncMock(return_value=[_SAMPLE_RESOURCE])
        with patch("backend.routers.ha._resolve_ha_read_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.get("/api/ha/resources")
        _clear(app)
        assert resp.status_code == 200
        assert resp.json()["items"][0]["sid"] == "vm:100"

    @pytest.mark.asyncio
    async def test_create_resource_success(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_resources = AsyncMock(return_value=[])
        mock_client.create_ha_resource = AsyncMock()
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha.write_audit_log", new_callable=AsyncMock),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/resources", json={"sid": "vm:100", "state": "started"})
        _clear(app)
        assert resp.status_code == 201
        params = mock_client.create_ha_resource.call_args.args[1]
        assert params["sid"] == "vm:100"

    @pytest.mark.asyncio
    async def test_create_resource_double_add_409(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_resources = AsyncMock(return_value=[{"sid": "service:vm:100"}])
        with patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/resources", json={"sid": "vm:100"})
        _clear(app)
        assert resp.status_code == 409


# ── Runtime actions (job) ────────────────────────────────────────────────────────

class TestHaRuntimeRouter:
    @pytest.mark.asyncio
    async def test_migrate_starts_job(self):
        from backend.main import app
        from backend.models.jobs import JobResponse
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_status_current = AsyncMock(return_value=_SAMPLE_STATUS)
        node_row = MagicMock(proxmox_node="pve1", cluster_nodes=["pve2"])
        fake_job = JobResponse(
            id="job-1", type="ha_migrate", playbook="migrate:vm:100→pve2",
            status="pending", created_at="now", username="hamgr", params={},
        )
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha._resolve_ha_node", AsyncMock(return_value=node_row)),
            patch("backend.routers.ha._create_ha_action_job", AsyncMock(return_value=fake_job)) as mk,
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/resources/vm:100/migrate", json={"node": "pve2"})
        _clear(app)
        assert resp.status_code == 202
        assert resp.json()["type"] == "ha_migrate"
        assert mk.await_count == 1

    @pytest.mark.asyncio
    async def test_migrate_invalid_target_422(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        node_row = MagicMock(proxmox_node="pve1", cluster_nodes=["pve2"])
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha._resolve_ha_node", AsyncMock(return_value=node_row)),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/resources/vm:100/migrate", json={"node": "pve99"})
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_migrate_same_node_422(self):
        from backend.main import app
        _override_user(app, _HA_MANAGER)
        mock_client = AsyncMock()
        mock_client.get_ha_status_current = AsyncMock(return_value=_SAMPLE_STATUS)  # vm:100 on pve1
        node_row = MagicMock(proxmox_node="pve1", cluster_nodes=["pve2"])
        with (
            patch("backend.routers.ha._resolve_ha_write_auth", AsyncMock(return_value=(mock_client, MagicMock()))),
            patch("backend.routers.ha._resolve_ha_node", AsyncMock(return_value=node_row)),
        ):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
                resp = await ac.post("/api/ha/resources/vm:100/migrate", json={"node": "pve1"})
        _clear(app)
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_migrate_blocked_for_viewer(self):
        from backend.main import app
        _override_user(app, _VIEWER_USER)
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            resp = await ac.post("/api/ha/resources/vm:100/migrate", json={"node": "pve2"})
        _clear(app)
        assert resp.status_code == 403


# ── PROJ-102 HA-awareness guard (_assert_ha_confirmed) ───────────────────────────

class TestAssertHaConfirmed:
    @pytest.mark.asyncio
    async def test_started_resource_without_confirm_raises_409(self):
        from fastapi import HTTPException
        from backend.routers.vms import _assert_ha_confirmed
        client = AsyncMock()
        client.get_ha_resources = AsyncMock(return_value=[{"sid": "vm:100", "state": "started", "group": "grp1"}])
        with patch("backend.routers.vms.write_audit_log", new_callable=AsyncMock):
            with pytest.raises(HTTPException) as ei:
                await _assert_ha_confirmed(client, MagicMock(), 100, False, "stop", "u", "local")
        assert ei.value.status_code == 409
        assert ei.value.detail["error"] == "ha_managed"
        assert ei.value.detail["sid"] == "vm:100"

    @pytest.mark.asyncio
    async def test_confirm_true_skips(self):
        from backend.routers.vms import _assert_ha_confirmed
        client = AsyncMock()
        client.get_ha_resources = AsyncMock()
        await _assert_ha_confirmed(client, MagicMock(), 100, True, "stop", "u", "local")
        client.get_ha_resources.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_ha_resource_proceeds(self):
        from backend.routers.vms import _assert_ha_confirmed
        client = AsyncMock()
        client.get_ha_resources = AsyncMock(return_value=[{"sid": "vm:200", "state": "started"}])
        await _assert_ha_confirmed(client, MagicMock(), 100, False, "stop", "u", "local")  # no raise

    @pytest.mark.asyncio
    async def test_stopped_state_proceeds(self):
        from backend.routers.vms import _assert_ha_confirmed
        client = AsyncMock()
        client.get_ha_resources = AsyncMock(return_value=[{"sid": "vm:100", "state": "stopped"}])
        await _assert_ha_confirmed(client, MagicMock(), 100, False, "stop", "u", "local")  # no raise

    @pytest.mark.asyncio
    async def test_read_error_proceeds(self):
        from backend.routers.vms import _assert_ha_confirmed
        client = AsyncMock()
        client.get_ha_resources = AsyncMock(side_effect=Exception("boom"))
        await _assert_ha_confirmed(client, MagicMock(), 100, False, "stop", "u", "local")  # best-effort → no raise

    @pytest.mark.asyncio
    async def test_service_prefixed_sid_matches(self):
        from fastapi import HTTPException
        from backend.routers.vms import _assert_ha_confirmed
        client = AsyncMock()
        client.get_ha_resources = AsyncMock(return_value=[{"sid": "service:ct:100", "state": "started"}])
        with patch("backend.routers.vms.write_audit_log", new_callable=AsyncMock):
            with pytest.raises(HTTPException):
                await _assert_ha_confirmed(client, MagicMock(), 100, False, "migrate", "u", "local")
