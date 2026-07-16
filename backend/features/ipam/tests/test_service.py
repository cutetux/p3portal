# p3portal.org
"""PROJ-42 Phase 1 – reine Logik-Tests: compute_free_ip + Schema-Validierung."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.features.ipam.schemas import IpPoolCreateRequest, IpPoolResponse
from backend.features.ipam.service import compute_free_ip


def _pool(**kw) -> IpPoolResponse:
    base = dict(
        id=1, kind="bridge", network_name="vmbr0", node="pve", vlan_tag=None,
        cidr="192.168.2.0/24", gateway="192.168.2.1", dns=None,
        range_start=None, range_end=None, description=None,
    )
    base.update(kw)
    return IpPoolResponse(**base)


# ── compute_free_ip ───────────────────────────────────────────────────────────

def test_free_skips_gateway_and_used():
    pool = _pool()
    # .1 = Gateway (skip), .2 + .3 belegt → .4
    assert compute_free_ip(pool, {"192.168.2.2", "192.168.2.3"}) == "192.168.2.4"


def test_free_lowest_when_empty():
    pool = _pool(gateway=None)
    assert compute_free_ip(pool, set()) == "192.168.2.1"


def test_free_respects_range():
    pool = _pool(gateway=None, range_start="192.168.2.10", range_end="192.168.2.20")
    assert compute_free_ip(pool, set()) == "192.168.2.10"
    assert compute_free_ip(pool, {"192.168.2.10"}) == "192.168.2.11"


def test_free_exhausted_returns_none():
    # /30 → nutzbare Hosts .1 + .2; .1 = Gateway, .2 belegt → keiner frei
    pool = _pool(cidr="192.168.2.0/30", gateway="192.168.2.1")
    assert compute_free_ip(pool, {"192.168.2.2"}) is None


def test_free_slash31_uses_both_addresses():
    pool = _pool(cidr="10.0.0.0/31", gateway=None)
    assert compute_free_ip(pool, set()) == "10.0.0.0"
    assert compute_free_ip(pool, {"10.0.0.0"}) == "10.0.0.1"


def test_free_slash32_single_host():
    pool = _pool(cidr="10.0.0.5/32", gateway=None)
    assert compute_free_ip(pool, set()) == "10.0.0.5"
    assert compute_free_ip(pool, {"10.0.0.5"}) is None


def test_free_ignores_broadcast_and_network():
    pool = _pool(cidr="192.168.2.0/29", gateway=None)
    # /29: Netz .0, Broadcast .7 nie vorgeschlagen; erster Host .1
    assert compute_free_ip(pool, set()) == "192.168.2.1"


# ── Schema-Validierung ────────────────────────────────────────────────────────

def test_schema_bridge_requires_node():
    with pytest.raises(ValidationError):
        IpPoolCreateRequest(kind="bridge", network_name="vmbr0", cidr="192.168.2.0/24")


def test_schema_vnet_clears_node():
    p = IpPoolCreateRequest(kind="vnet", network_name="guests", node="pve", cidr="10.0.0.0/24")
    assert p.node is None


def test_schema_gateway_must_be_in_cidr():
    with pytest.raises(ValidationError):
        IpPoolCreateRequest(
            kind="bridge", network_name="vmbr0", node="pve",
            cidr="192.168.2.0/24", gateway="10.0.0.1",
        )


def test_schema_rejects_ipv6():
    with pytest.raises(ValidationError):
        IpPoolCreateRequest(kind="bridge", network_name="vmbr0", node="pve", cidr="fd00::/64")


def test_schema_range_order():
    with pytest.raises(ValidationError):
        IpPoolCreateRequest(
            kind="bridge", network_name="vmbr0", node="pve", cidr="192.168.2.0/24",
            range_start="192.168.2.50", range_end="192.168.2.10",
        )


def test_schema_vlan_bounds():
    with pytest.raises(ValidationError):
        IpPoolCreateRequest(
            kind="bridge", network_name="vmbr0", node="pve",
            cidr="192.168.2.0/24", vlan_tag=5000,
        )
    ok = IpPoolCreateRequest(
        kind="bridge", network_name="vmbr0", node="pve",
        cidr="192.168.2.0/24", vlan_tag=10,
    )
    assert ok.vlan_tag == 10
