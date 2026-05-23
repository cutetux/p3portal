# p3portal.org
"""PROJ-47: Unit-Tests für den Node-Assignments-Service."""
from __future__ import annotations

import json

import pytest

from backend.features.node_assignments.schemas import VALID_NODE_ACTIONS, NodeAssignmentAddRequest


# ── VALID_NODE_ACTIONS ────────────────────────────────────────────────────────

def test_valid_node_actions_contains_expected():
    assert "node:view_tasks" in VALID_NODE_ACTIONS
    assert "node:view_backups" in VALID_NODE_ACTIONS
    assert "node:upload_iso" in VALID_NODE_ACTIONS


def test_valid_node_actions_frozenset():
    assert isinstance(VALID_NODE_ACTIONS, frozenset)


# ── NodeAssignmentAddRequest Validation ───────────────────────────────────────

def test_request_user_type():
    req = NodeAssignmentAddRequest(subject_type="user", subject_id=1, role_preset_id=2)
    assert req.subject_type == "user"
    assert req.subject_id == 1
    assert req.role_preset_id == 2


def test_request_group_type():
    req = NodeAssignmentAddRequest(subject_type="group", subject_id=5, role_preset_id=3)
    assert req.subject_type == "group"


def test_request_invalid_subject_type():
    with pytest.raises(Exception):
        NodeAssignmentAddRequest(subject_type="service_account", subject_id=1, role_preset_id=1)


# ── _row_to_response ──────────────────────────────────────────────────────────

def test_row_to_response_basic():
    from backend.features.node_assignments.service import _row_to_response

    row = {
        "id": 1,
        "node_id": 2,
        "subject_type": "user",
        "subject_id": 3,
        "subject_display": "alice",
        "role_preset_id": 4,
        "preset_name": "Viewer",
        "node_actions": '["node:view_tasks"]',
        "added_at": "2026-01-01T00:00:00+00:00",
        "added_by": "admin",
    }
    result = _row_to_response(row)
    assert result["id"] == 1
    assert result["node_id"] == 2
    assert result["subject_display"] == "alice"
    assert result["preset_node_actions"] == ["node:view_tasks"]


def test_row_to_response_empty_node_actions():
    from backend.features.node_assignments.service import _row_to_response

    row = {
        "id": 1,
        "node_id": 2,
        "subject_type": "user",
        "subject_id": 3,
        "subject_display": None,
        "role_preset_id": 4,
        "preset_name": "Viewer",
        "node_actions": "[]",
        "added_at": "2026-01-01T00:00:00+00:00",
        "added_by": "admin",
    }
    result = _row_to_response(row)
    assert result["preset_node_actions"] == []


def test_row_to_response_invalid_json_defaults_empty():
    from backend.features.node_assignments.service import _row_to_response

    row = {
        "id": 1,
        "node_id": 2,
        "subject_type": "user",
        "subject_id": 3,
        "subject_display": None,
        "role_preset_id": 4,
        "preset_name": "Viewer",
        "node_actions": None,
        "added_at": "2026-01-01T00:00:00+00:00",
        "added_by": "admin",
    }
    result = _row_to_response(row)
    assert result["preset_node_actions"] == []


# ── PresetResponse includes node_actions ─────────────────────────────────────

def test_preset_response_node_actions_field():
    from backend.models.rbac import PresetResponse

    preset = PresetResponse(
        id=1,
        name="TestPreset",
        description="desc",
        permissions=["view"],
        node_actions=["node:view_tasks"],
        created_at="2026-01-01T00:00:00+00:00",
        created_by="admin",
    )
    assert preset.node_actions == ["node:view_tasks"]


def test_preset_response_node_actions_default():
    from backend.models.rbac import PresetResponse

    preset = PresetResponse(
        id=1,
        name="TestPreset",
        description="",
        permissions=[],
        created_at="2026-01-01T00:00:00+00:00",
        created_by="admin",
    )
    assert preset.node_actions == []


# ── PresetCreateRequest validates node_actions ────────────────────────────────

def test_preset_create_request_valid_node_actions():
    from backend.models.rbac import PresetCreateRequest

    req = PresetCreateRequest(
        name="NodePreset",
        permissions=["view"],
        node_actions=["node:view_tasks", "node:view_backups"],
    )
    assert req.node_actions == ["node:view_tasks", "node:view_backups"]


def test_preset_create_request_invalid_node_action():
    from backend.models.rbac import PresetCreateRequest
    with pytest.raises(Exception):
        PresetCreateRequest(
            name="BadPreset",
            permissions=["view"],
            node_actions=["node:invalid_action"],
        )


def test_preset_create_request_empty_node_actions():
    from backend.models.rbac import PresetCreateRequest

    req = PresetCreateRequest(name="SimplePreset", permissions=["view"])
    assert req.node_actions == []


# ── MyNodeAssignmentEntry Pydantic construction ───────────────────────────────

def test_my_node_assignment_entry_direct():
    from backend.features.node_assignments.schemas import MyNodeAssignmentEntry

    entry = MyNodeAssignmentEntry(
        node_id=1,
        node_name="pve1",
        role_preset_id=2,
        preset_name="Viewer",
        preset_permissions=["view"],
        preset_node_actions=["node:view_tasks"],
        source="direct",
        source_group_name=None,
    )
    assert entry.source == "direct"
    assert entry.source_group_name is None


def test_my_node_assignment_entry_via_group():
    from backend.features.node_assignments.schemas import MyNodeAssignmentEntry

    entry = MyNodeAssignmentEntry(
        node_id=1,
        node_name="pve1",
        role_preset_id=2,
        preset_name="Viewer",
        preset_permissions=["view"],
        preset_node_actions=[],
        source="group",
        source_group_name="DevTeam",
    )
    assert entry.source == "group"
    assert entry.source_group_name == "DevTeam"
