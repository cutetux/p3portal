# p3portal.org
"""PROJ-26: Tests for Token-Konsolidierung.

Covers:
- cluster_nodes CRUD (create / update / get_node_for_proxmox_name)
- get_config_sync env-var → cache behaviour (no more _TOKEN_KEYS special-casing)
- get_node_tokens: direct match, cluster_nodes match, single-install fallback,
  multi-install no-fallback, node-no-token returns None
- init_env_token_bootstrap: bootstrap (no tokens yet) and override modes,
  writing EXCLUSIVELY to the default node
"""
from __future__ import annotations

import json
import os
import pytest
import pytest_asyncio

from backend.db.database import init_db


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db(tmp_path):
    await init_db()
    yield


# ─── nodes_service: cluster_nodes CRUD ───────────────────────────────────────

@pytest.mark.asyncio
async def test_create_node_with_cluster_nodes(db):
    from backend.services.nodes_service import create_node, get_node

    node = await create_node(
        name="Cluster A",
        url="https://pve.example.com:8006",
        proxmox_node="node-a",
        verify_ssl=False,
        token_id="user@pam!tok",
        token_secret="secret",
        cluster_nodes=["node-b", "node-c"],
    )
    assert node.cluster_nodes == ["node-b", "node-c"]

    fetched = await get_node(node.id)
    assert fetched is not None
    assert fetched.cluster_nodes == ["node-b", "node-c"]


@pytest.mark.asyncio
async def test_create_node_without_cluster_nodes(db):
    from backend.services.nodes_service import create_node

    node = await create_node(
        name="Standalone",
        url="https://pve2.example.com:8006",
        proxmox_node="pve2",
        verify_ssl=True,
        token_id="user@pam!tok",
        token_secret="secret",
    )
    assert node.cluster_nodes == []


@pytest.mark.asyncio
async def test_update_node_cluster_nodes(db):
    from backend.services.nodes_service import create_node, update_node

    node = await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="tid", token_secret="tsec",
    )
    updated = await update_node(node.id, cluster_nodes=["node-b", "node-d"])
    assert updated is not None
    assert updated.cluster_nodes == ["node-b", "node-d"]


@pytest.mark.asyncio
async def test_update_node_clear_cluster_nodes(db):
    from backend.services.nodes_service import create_node, update_node

    node = await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="tid", token_secret="tsec",
        cluster_nodes=["node-b"],
    )
    updated = await update_node(node.id, cluster_nodes=[])
    assert updated is not None
    assert updated.cluster_nodes == []


@pytest.mark.asyncio
async def test_update_node_preserves_cluster_nodes_when_none(db):
    from backend.services.nodes_service import create_node, update_node

    node = await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="tid", token_secret="tsec",
        cluster_nodes=["node-b", "node-c"],
    )
    # Not passing cluster_nodes → should preserve existing value
    updated = await update_node(node.id, name="Cluster Renamed")
    assert updated is not None
    assert updated.cluster_nodes == ["node-b", "node-c"]


# ─── get_node_for_proxmox_name: cluster_nodes search ─────────────────────────

@pytest.mark.asyncio
async def test_get_node_for_proxmox_name_direct_match(db):
    from backend.services.nodes_service import create_node, get_node_for_proxmox_name

    await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="tid", token_secret="tsec",
        cluster_nodes=["node-b", "node-c"],
    )
    found = await get_node_for_proxmox_name("node-a")
    assert found is not None
    assert found.proxmox_node == "node-a"


@pytest.mark.asyncio
async def test_get_node_for_proxmox_name_cluster_member(db):
    from backend.services.nodes_service import create_node, get_node_for_proxmox_name

    node = await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="tid", token_secret="tsec",
        cluster_nodes=["node-b", "node-c"],
    )
    found_b = await get_node_for_proxmox_name("node-b")
    assert found_b is not None
    assert found_b.id == node.id

    found_c = await get_node_for_proxmox_name("node-c")
    assert found_c is not None
    assert found_c.id == node.id


@pytest.mark.asyncio
async def test_get_node_for_proxmox_name_not_found(db):
    from backend.services.nodes_service import create_node, get_node_for_proxmox_name

    await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="tid", token_secret="tsec",
        cluster_nodes=["node-b"],
    )
    found = await get_node_for_proxmox_name("node-x")
    assert found is None


# ─── get_config_sync: env-var → cache (no more _TOKEN_KEYS) ──────────────────

def test_get_config_sync_reads_env_for_any_key(monkeypatch):
    """All keys (including token keys) now read env-var first."""
    from backend.services import config_service

    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_viewer_token_id": "env-token-id",
            "proxmox_host": "https://pve:8006",
            "proxmox_node": "pve",
            "proxmox_verify_ssl": True,
            "packer_token_id": None,
            "packer_token_secret": None,
            "proxmox_viewer_token_secret": None,
            "proxmox_operator_token_id": None,
            "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None,
            "proxmox_admin_token_secret": None,
        })(),
    )
    config_service._cache.pop("proxmox_viewer_token_id", None)

    result = config_service.get_config_sync("proxmox_viewer_token_id")
    # Env-var is now used for token keys (no special-casing)
    assert result == "env-token-id"


def test_get_config_sync_reads_cache_when_no_env(monkeypatch):
    from backend.services import config_service

    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_viewer_token_id": None,
            "proxmox_host": None,
            "proxmox_node": None,
            "proxmox_verify_ssl": True,
            "packer_token_id": None,
            "packer_token_secret": None,
            "proxmox_viewer_token_secret": None,
            "proxmox_operator_token_id": None,
            "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None,
            "proxmox_admin_token_secret": None,
            "packer_http_ip": None,
        })(),
    )
    config_service._cache["proxmox_viewer_token_id"] = "cached-token-id"
    try:
        result = config_service.get_config_sync("proxmox_viewer_token_id")
        assert result == "cached-token-id"
    finally:
        config_service._cache.pop("proxmox_viewer_token_id", None)


def test_get_config_sync_non_token_key_reads_env(monkeypatch):
    from backend.services import config_service

    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_host": "https://env-host:8006",
            "proxmox_node": "pve",
            "proxmox_verify_ssl": True,
            "packer_token_id": None,
            "packer_token_secret": None,
            "proxmox_viewer_token_id": None,
            "proxmox_viewer_token_secret": None,
            "proxmox_operator_token_id": None,
            "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None,
            "proxmox_admin_token_secret": None,
            "packer_http_ip": None,
        })(),
    )
    config_service._cache.pop("proxmox_host", None)

    result = config_service.get_config_sync("proxmox_host")
    assert result == "https://env-host:8006"


# ─── get_node_tokens: multi-installation logic ───────────────────────────────

@pytest.mark.asyncio
async def test_get_node_tokens_direct_match(db):
    from backend.services.nodes_service import create_node
    from backend.services.service_accounts import get_node_tokens

    await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="", token_secret="",
        viewer_token_id="vid", viewer_token_secret="vsec",
        cluster_nodes=["node-b"],
    )
    tok, host, verify = await get_node_tokens("node-a", "viewer")
    assert tok is not None
    assert tok.token_id == "vid"
    assert host == "https://pve.example.com:8006"


@pytest.mark.asyncio
async def test_get_node_tokens_cluster_member_match(db):
    from backend.services.nodes_service import create_node
    from backend.services.service_accounts import get_node_tokens

    await create_node(
        name="Cluster", url="https://pve.example.com:8006",
        proxmox_node="node-a", verify_ssl=False,
        token_id="", token_secret="",
        viewer_token_id="vid", viewer_token_secret="vsec",
        cluster_nodes=["node-b", "node-c"],
    )
    # node-b is a cluster member
    tok, host, _ = await get_node_tokens("node-b", "viewer")
    assert tok is not None
    assert tok.token_id == "vid"
    assert host == "https://pve.example.com:8006"


@pytest.mark.asyncio
async def test_get_node_tokens_single_install_fallback(db):
    """With 1 Portal entry: unknown node name falls back to that entry."""
    from backend.services.nodes_service import create_node
    from backend.services.service_accounts import get_node_tokens

    await create_node(
        name="Standalone", url="https://pve.example.com:8006",
        proxmox_node="pve", verify_ssl=False,
        token_id="", token_secret="",
        viewer_token_id="vid", viewer_token_secret="vsec",
    )
    tok, host, _ = await get_node_tokens("unknown-node", "viewer")
    assert tok is not None
    assert tok.token_id == "vid"
    assert host == "https://pve.example.com:8006"


@pytest.mark.asyncio
async def test_get_node_tokens_multi_install_no_fallback(db):
    """With 2+ Portal entries: unknown node returns (None, ...) – no blind fallback."""
    from backend.services.nodes_service import create_node
    from backend.services.service_accounts import get_node_tokens
    from unittest.mock import patch

    with patch("backend.core.license.is_plus_edition", return_value=True):
        await create_node(
            name="Install A", url="https://pve-a.example.com:8006",
            proxmox_node="node-a", verify_ssl=False,
            token_id="", token_secret="",
            viewer_token_id="vid-a", viewer_token_secret="vsec-a",
        )
        await create_node(
            name="Install B", url="https://pve-b.example.com:8006",
            proxmox_node="node-b", verify_ssl=False,
            token_id="", token_secret="",
            viewer_token_id="vid-b", viewer_token_secret="vsec-b",
        )

    tok, _, _ = await get_node_tokens("unknown-node", "viewer")
    assert tok is None


@pytest.mark.asyncio
async def test_get_node_tokens_node_no_token_returns_none(db):
    """Node found but has no per-node token → returns (None, host, verify)."""
    from backend.services.nodes_service import create_node
    from backend.services.service_accounts import get_node_tokens

    await create_node(
        name="Node No Token", url="https://pve.example.com:8006",
        proxmox_node="pve", verify_ssl=False,
        token_id="", token_secret="",
        # No viewer token configured
    )
    tok, host, _ = await get_node_tokens("pve", "viewer")
    assert tok is None
    assert host == "https://pve.example.com:8006"


# ─── init_env_token_bootstrap: writes to default node ────────────────────────

@pytest.mark.asyncio
async def test_bootstrap_writes_to_node_when_no_tokens(db, monkeypatch):
    """Bootstrap writes env-var tokens to default node when it has no tokens."""
    from backend.services import config_service
    from backend.services.nodes_service import create_node, get_node

    node = await create_node(
        name="Default", url="https://pve.example.com:8006",
        proxmox_node="pve", verify_ssl=False,
        token_id="", token_secret="",
        # No tokens configured yet
    )

    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_viewer_token_id": "env-vid", "proxmox_viewer_token_secret": "env-vsec",
            "proxmox_operator_token_id": None, "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None, "proxmox_admin_token_secret": None,
            "packer_token_id": None, "packer_token_secret": None,
            "secret_key": "test-secret-key-32-chars-minimum!!",
            "data_dir": str(monkeypatch._locs[0] if hasattr(monkeypatch, "_locs") else "/tmp"),
        })(),
    )

    await config_service.init_env_token_bootstrap()

    refreshed = await get_node(node.id)
    assert refreshed is not None
    assert refreshed.viewer_token_id == "env-vid"
    assert refreshed.viewer_token_secret == "env-vsec"


@pytest.mark.asyncio
async def test_bootstrap_skips_when_node_already_has_tokens(db, monkeypatch):
    """Bootstrap does NOT overwrite tokens when node already has them."""
    from backend.services import config_service
    from backend.services.nodes_service import create_node, get_node

    node = await create_node(
        name="Default", url="https://pve.example.com:8006",
        proxmox_node="pve", verify_ssl=False,
        token_id="", token_secret="",
        viewer_token_id="existing-vid", viewer_token_secret="existing-vsec",
    )

    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_viewer_token_id": "new-vid-from-env", "proxmox_viewer_token_secret": "new-vsec",
            "proxmox_operator_token_id": None, "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None, "proxmox_admin_token_secret": None,
            "packer_token_id": None, "packer_token_secret": None,
            "secret_key": "test-secret-key-32-chars-minimum!!",
        })(),
    )

    await config_service.init_env_token_bootstrap()

    refreshed = await get_node(node.id)
    assert refreshed is not None
    # Must still have the original tokens
    assert refreshed.viewer_token_id == "existing-vid"


@pytest.mark.asyncio
async def test_env_token_override_updates_node(db, monkeypatch):
    """Override mode unconditionally updates the default node's tokens."""
    from backend.services import config_service
    from backend.services.nodes_service import create_node, get_node

    node = await create_node(
        name="Default", url="https://pve.example.com:8006",
        proxmox_node="pve", verify_ssl=False,
        token_id="", token_secret="",
        viewer_token_id="old-vid", viewer_token_secret="old-vsec",
        admin_token_id="old-aid", admin_token_secret="old-asec",
    )

    monkeypatch.setenv("ENV_TOKEN_OVERRIDE", "true")
    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_viewer_token_id": "override-vid", "proxmox_viewer_token_secret": "override-vsec",
            "proxmox_operator_token_id": None, "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None, "proxmox_admin_token_secret": None,
            "packer_token_id": None, "packer_token_secret": None,
            "secret_key": "test-secret-key-32-chars-minimum!!",
        })(),
    )

    await config_service.init_env_token_bootstrap()
    monkeypatch.delenv("ENV_TOKEN_OVERRIDE")

    refreshed = await get_node(node.id)
    assert refreshed is not None
    assert refreshed.viewer_token_id == "override-vid"
    assert refreshed.viewer_token_secret == "override-vsec"
    # admin tokens not in env → preserved (None passed → update_node keeps existing)
    assert refreshed.admin_token_id == "old-aid"


@pytest.mark.asyncio
async def test_bootstrap_no_node_skips(db, monkeypatch):
    """Bootstrap silently skips when no default node exists."""
    from backend.services import config_service

    monkeypatch.setattr(
        "backend.core.config.settings",
        type("S", (), {
            "proxmox_viewer_token_id": "vid", "proxmox_viewer_token_secret": "vsec",
            "proxmox_operator_token_id": None, "proxmox_operator_token_secret": None,
            "proxmox_admin_token_id": None, "proxmox_admin_token_secret": None,
            "packer_token_id": None, "packer_token_secret": None,
            "secret_key": "test-secret-key-32-chars-minimum!!",
        })(),
    )

    # No exception even though there's no node in DB
    await config_service.init_env_token_bootstrap()
