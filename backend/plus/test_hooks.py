# SPDX-License-Identifier: LicenseRef-P3-Plus
# SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
# === P3 PLUS – PROPRIETARY ===
# Licensed under LICENSE-PLUS (see repo root)
# Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
# Contact: license@p3portal.org

# p3portal.org
"""PROJ-60: Tests für Plus-Mixins und PlusActiveBehavior-Komposition.

Plus-only Tests (direkter Zugriff auf Plus-Code) sind mit
@pytest.mark.plus_only markiert – sie werden im Pure-Core-Build via
`pytest -m "not plus_only"` ausgeschlossen.
"""
import pytest

from backend.core.license import CORE_MAX_PRESETS, CORE_MAX_USERS
from backend.core.plus_protocol import CorePlusBehavior, plus_behavior
from backend.services.user_api_key_service import CORE_MAX_KEYS, DEFAULT_PLUS_MAX_KEYS


# ── CorePlusBehavior-Stubs (kein Plus-only – Core-Code) ─────────────────────

class TestCorePlusBehaviorStubs:
    def test_gate_hooks_return_false(self):
        b = CorePlusBehavior()
        assert b.can_use_alert_presets() is False
        assert b.can_use_theme_editor() is False
        assert b.can_add_multiple_nodes() is False
        assert b.can_set_default_node() is False
        assert b.can_use_scheduled_jobs() is False
        assert b.can_change_language() is False
        assert b.can_use_cluster_resources() is False
        assert b.can_use_multi_node_dashboard() is False
        assert b.can_use_alerts_smtp() is False
        assert b.can_use_approval_workflow() is False
        assert b.can_use_compute_alerting() is False
        assert b.can_use_compute_scheduled_jobs() is False

    def test_limit_hooks_return_core_defaults(self):
        b = CorePlusBehavior()
        assert b.get_max_users() == CORE_MAX_USERS
        assert b.get_max_presets() == CORE_MAX_PRESETS
        assert b.get_max_api_keys({}) == CORE_MAX_KEYS
        assert b.get_max_api_keys({"api_keys_max_count": 99}) == CORE_MAX_KEYS

    def test_filter_alert_notification_strips_plus_fields(self):
        b = CorePlusBehavior()
        result = b.filter_alert_notification_fields(
            {"webhook_url": "https://x", "webhook_token": "tok", "email_recipients": ["a@b.c"], "name": "test"}
        )
        assert result["webhook_url"] is None
        assert result["webhook_token"] is None
        assert result["email_recipients"] is None
        assert result["name"] == "test"

    def test_packer_session_fields_returns_empty(self):
        b = CorePlusBehavior()
        assert b.get_packer_session_fields({}) == {}

    def test_cluster_node_extra_returns_empty(self):
        b = CorePlusBehavior()
        assert b.get_cluster_node_extra({}) == {}


# ── Plus-Mixins direkt (@pytest.mark.plus_only) ──────────────────────────────

@pytest.mark.plus_only
class TestAlertsPlusMixin:
    def test_alerts_plus_enables_presets(self):
        from backend.plus.alerts_plus import AlertsPlusBehavior
        a = AlertsPlusBehavior()
        assert a.can_use_alert_presets() is True

    def test_alerts_plus_passes_notification_fields_through(self):
        from backend.plus.alerts_plus import AlertsPlusBehavior
        a = AlertsPlusBehavior()
        fields = {"webhook_url": "https://x", "webhook_token": "t", "email_recipients": ["a@b.c"]}
        assert a.filter_alert_notification_fields(fields) == fields


@pytest.mark.plus_only
class TestPlusActiveBehaviorComposition:
    def test_active_overrides_alert_presets_gate(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.can_use_alert_presets() is True

    def test_active_passes_notification_fields_through(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        fields = {"webhook_url": "https://x", "webhook_token": "t", "email_recipients": ["a@b.c"]}
        assert a.filter_alert_notification_fields(fields) == fields

    def test_active_overrides_theme_editor_gate(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.can_use_theme_editor() is True

    def test_active_overrides_multi_node_gates(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.can_add_multiple_nodes() is True
        assert a.can_set_default_node() is True

    def test_active_overrides_packer_cluster_resources(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.can_use_cluster_resources() is True

    def test_active_overrides_multi_node_dashboard(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.can_use_multi_node_dashboard() is True

    def test_active_lifts_core_user_and_preset_limits(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.get_max_users() is None
        assert a.get_max_presets() is None

    def test_active_enables_language_upload(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.can_change_language() is True

    def test_active_uses_plus_api_key_limits(self):
        from backend.plus import PlusActiveBehavior
        a = PlusActiveBehavior()
        assert a.get_max_api_keys({}) == DEFAULT_PLUS_MAX_KEYS
        assert a.get_max_api_keys({"api_keys_max_count": 7}) == 7

    def test_active_is_subclass_of_core_behavior(self):
        from backend.plus import PlusActiveBehavior
        assert issubclass(PlusActiveBehavior, CorePlusBehavior)


@pytest.mark.plus_only
class TestThemesPlusMixin:
    def test_themes_plus_enables_editor(self):
        from backend.plus.themes_plus import ThemesPlusBehavior
        t = ThemesPlusBehavior()
        assert t.can_use_theme_editor() is True


@pytest.mark.plus_only
class TestNodesPlusMixin:
    def test_nodes_plus_enables_multi_node(self):
        from backend.plus.nodes_plus import NodesPlusBehavior
        n = NodesPlusBehavior()
        assert n.can_add_multiple_nodes() is True

    def test_nodes_plus_enables_default_node(self):
        from backend.plus.nodes_plus import NodesPlusBehavior
        n = NodesPlusBehavior()
        assert n.can_set_default_node() is True


@pytest.mark.plus_only
class TestPackerPlusMixin:
    def test_packer_plus_enables_cluster_resources(self):
        from backend.plus.packer_plus import PackerPlusBehavior
        p = PackerPlusBehavior()
        assert p.can_use_cluster_resources() is True


@pytest.mark.plus_only
class TestClusterPlusMixin:
    def test_cluster_plus_enables_multi_node_dashboard(self):
        from backend.plus.cluster_plus import ClusterPlusBehavior
        c = ClusterPlusBehavior()
        assert c.can_use_multi_node_dashboard() is True


@pytest.mark.plus_only
class TestMiscPlusMixin:
    def test_misc_plus_lifts_user_and_preset_limits(self):
        from backend.plus.misc_plus import MiscPlusBehavior
        m = MiscPlusBehavior()
        assert m.get_max_users() is None
        assert m.get_max_presets() is None

    def test_misc_plus_enables_language_change(self):
        from backend.plus.misc_plus import MiscPlusBehavior
        m = MiscPlusBehavior()
        assert m.can_change_language() is True

    def test_misc_plus_default_api_key_limit(self):
        from backend.plus.misc_plus import MiscPlusBehavior
        m = MiscPlusBehavior()
        assert m.get_max_api_keys({}) == DEFAULT_PLUS_MAX_KEYS

    def test_misc_plus_custom_api_key_limit_overrides_default(self):
        from backend.plus.misc_plus import MiscPlusBehavior
        m = MiscPlusBehavior()
        assert m.get_max_api_keys({"api_keys_max_count": 12}) == 12


# ── plus_behavior Dispatcher-Tests (Core-Code, kein plus_only) ───────────────

class TestPlusBehaviorDispatcher:
    def test_dispatcher_importable(self):
        assert plus_behavior is not None

    def test_core_mode_returns_core_defaults(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        assert plus_behavior.can_use_alert_presets() is False
        assert plus_behavior.get_max_users() == CORE_MAX_USERS

    def test_plus_mode_enables_alert_presets(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        assert plus_behavior.can_use_alert_presets() is True

    def test_plus_mode_passes_notification_fields(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        fields = {"webhook_url": "https://x", "webhook_token": "t", "email_recipients": ["a@b.c"]}
        assert plus_behavior.filter_alert_notification_fields(fields) == fields

    def test_core_mode_strips_notification_fields(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        result = plus_behavior.filter_alert_notification_fields(
            {"webhook_url": "https://x", "webhook_token": "t", "email_recipients": ["a@b.c"]}
        )
        assert result["webhook_url"] is None
        assert result["webhook_token"] is None
        assert result["email_recipients"] is None

    def test_dynamic_switching(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        assert plus_behavior.can_use_alert_presets() is False
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        assert plus_behavior.can_use_alert_presets() is True

    def test_monkeypatch_on_dispatcher_directly(self, monkeypatch):
        monkeypatch.setattr(plus_behavior, "can_use_alert_presets", lambda: True)
        assert plus_behavior.can_use_alert_presets() is True

    def test_monkeypatch_takes_precedence_over_dispatcher(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        monkeypatch.setattr(plus_behavior, "can_use_scheduled_jobs", lambda: True)
        # Core-Edition, aber Patch überschreibt
        assert plus_behavior.can_use_scheduled_jobs() is True

    def test_user_and_preset_limits_switch_with_edition(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        assert plus_behavior.get_max_users() == CORE_MAX_USERS
        assert plus_behavior.get_max_presets() == CORE_MAX_PRESETS
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        assert plus_behavior.get_max_users() is None
        assert plus_behavior.get_max_presets() is None
