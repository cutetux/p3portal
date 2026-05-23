# p3portal.org
"""PROJ-26: Token-Konsolidierung – tokens live EXCLUSIVELY in the nodes table.

ServiceAccountService (portal_config reader) has been removed.
All token lookups go through the nodes table via get_node_tokens() or _extract_token().
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenConfig:
    token_id: str
    token_secret: str


def _extract_token(node, role: str) -> TokenConfig | None:
    """Return per-node TokenConfig for the given role, or None if not configured."""
    if role == "viewer" and node.viewer_token_id and node.viewer_token_secret:
        return TokenConfig(token_id=node.viewer_token_id, token_secret=node.viewer_token_secret)
    if role == "operator" and node.operator_token_id and node.operator_token_secret:
        return TokenConfig(token_id=node.operator_token_id, token_secret=node.operator_token_secret)
    if role == "admin" and node.admin_token_id and node.admin_token_secret:
        return TokenConfig(token_id=node.admin_token_id, token_secret=node.admin_token_secret)
    if role == "packer" and node.packer_token_id and node.packer_token_secret:
        return TokenConfig(token_id=node.packer_token_id, token_secret=node.packer_token_secret)
    return None


async def get_node_tokens(
    proxmox_node: str, role: str
) -> tuple[TokenConfig | None, str, bool]:
    """Resolve (TokenConfig|None, host_url, verify_ssl) for a Proxmox node + role.

    PROJ-26 lookup chain (tokens ONLY from nodes table – no portal_config fallback):
      1. nodes table – match proxmox_node OR cluster_nodes of a Portal entry
         → per-node token for the role (None if node exists but has no token)
      2. No match + exactly 1 Portal entry → single-install fallback (backwards-compat)
         → per-node token (None if no token configured)
      3. No match + 0 entries → (None, global_host, global_verify)
      4. No match + multiple entries → (None, global_host, global_verify)
         (refuse to guess; require explicit cluster_nodes mapping)

    Callers must treat (None, ...) as an error – no token available.
    """
    from backend.core.config import settings
    from backend.services.config_service import get_config_sync, get_proxmox_verify_ssl
    from backend.services.nodes_service import (
        count_nodes,
        get_default_node,
        get_node_for_proxmox_name,
    )

    global_host = get_config_sync("proxmox_host") or settings.proxmox_host
    global_verify = get_proxmox_verify_ssl()

    # Step 1: direct match (proxmox_node or cluster_nodes)
    node = await get_node_for_proxmox_name(proxmox_node)
    if node:
        tok = _extract_token(node, role)
        return tok, node.url, node.verify_ssl

    # Step 2 / 3 / 4: no matching node – decide based on portal entry count
    total = await count_nodes()
    if total == 0:
        return None, global_host, global_verify

    if total == 1:
        # Single-installation fallback – backwards-compatible with existing deployments
        fallback = await get_default_node()
        if fallback:
            tok = _extract_token(fallback, role)
            return tok, fallback.url, fallback.verify_ssl

    # Multiple installations – refuse to guess; require explicit cluster_nodes mapping
    return None, global_host, global_verify


async def get_service_account_status() -> dict[str, bool]:
    """Return token availability per role for the default Portal node."""
    from backend.services.nodes_service import get_default_node
    node = await get_default_node()
    if not node:
        return {"viewer": False, "operator": False, "admin": False}
    return {
        "viewer":   bool(node.viewer_token_id and node.viewer_token_secret),
        "operator": bool(node.operator_token_id and node.operator_token_secret),
        "admin":    bool(node.admin_token_id and node.admin_token_secret),
    }
