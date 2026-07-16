# p3portal.org
"""PROJ-42 Phase 1 – Core Simple-IPAM Service.

Pool-CRUD (Admin/manage_ipam) + zustandsloser best-effort Free-IP-Vorschlag,
berechnet live aus Proxmox (dieselbe Quelle wie das Dashboard). Kein Allocation-
Store — das ist Phase 2 (Plus).

NULL-Normalisierung: die DB hält `node`/`vlan_tag` als Sentinels ('' / 0), damit
der Unique-Constraint portabel greift; die API-Schicht führt None. `_to_db` /
`_from_row` mappen zwischen beiden Welten.
"""
from __future__ import annotations

import ipaddress
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.features.ipam.schemas import (
    IpPoolCreateRequest,
    IpPoolResponse,
    IpPoolUpdateRequest,
    SuggestResponse,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── NULL-Sentinel-Mapping ─────────────────────────────────────────────────────

def _node_to_db(node: Optional[str]) -> str:
    return node or ""


def _vlan_to_db(vlan: Optional[int]) -> int:
    return int(vlan) if vlan else 0


def _from_row(row) -> IpPoolResponse:
    dns_raw = row["dns"]
    dns = None
    if dns_raw:
        try:
            dns = json.loads(dns_raw)
        except (json.JSONDecodeError, TypeError):
            dns = None
    return IpPoolResponse(
        id=row["id"],
        kind=row["kind"],
        network_name=row["network_name"],
        node=(row["node"] or None),
        vlan_tag=(row["vlan_tag"] or None),
        cidr=row["cidr"],
        gateway=row["gateway"],
        dns=dns,
        range_start=row["range_start"],
        range_end=row["range_end"],
        description=row["description"],
        created_by=row["created_by"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _payload(body: IpPoolCreateRequest | IpPoolUpdateRequest) -> dict:
    return {
        "kind": body.kind,
        "network_name": body.network_name,
        "node": _node_to_db(body.node),
        "vlan_tag": _vlan_to_db(body.vlan_tag),
        "cidr": body.cidr,
        "gateway": body.gateway,
        "dns": json.dumps(body.dns) if body.dns else None,
        "range_start": body.range_start,
        "range_end": body.range_end,
        "description": body.description,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def list_pools() -> list[IpPoolResponse]:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM ip_pools ORDER BY network_name, cidr")
        )
        rows = result.mappings().fetchall()
    return [_from_row(r) for r in rows]


async def get_pool(pool_id: int) -> Optional[IpPoolResponse]:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT * FROM ip_pools WHERE id = :id"), {"id": pool_id}
        )
        row = result.mappings().fetchone()
    return _from_row(row) if row else None


async def pools_for_network(
    kind: str, network_name: str, node: Optional[str], vlan_tag: Optional[int]
) -> list[IpPoolResponse]:
    """Alle Pools, die an ein konkretes Netz gebunden sind (Deploy-Auflösung)."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT * FROM ip_pools "
                "WHERE kind = :kind AND network_name = :net "
                "AND node = :node AND vlan_tag = :vlan "
                "ORDER BY cidr"
            ),
            {
                "kind": kind,
                "net": network_name,
                "node": _node_to_db(node),
                "vlan": _vlan_to_db(vlan_tag),
            },
        )
        rows = result.mappings().fetchall()
    return [_from_row(r) for r in rows]


async def create_pool(body: IpPoolCreateRequest, created_by: str) -> IpPoolResponse:
    payload = _payload(body)
    payload["created_by"] = created_by
    payload["created_at"] = _now_iso()
    payload["updated_at"] = payload["created_at"]
    async with get_db() as db:
        try:
            result = await db.execute(
                text(
                    "INSERT INTO ip_pools "
                    "(kind, network_name, node, vlan_tag, cidr, gateway, dns, "
                    " range_start, range_end, description, created_by, created_at, updated_at) "
                    "VALUES (:kind, :network_name, :node, :vlan_tag, :cidr, :gateway, :dns, "
                    " :range_start, :range_end, :description, :created_by, :created_at, :updated_at) "
                    "RETURNING id"
                ),
                payload,
            )
            new_id = result.fetchone()[0]
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Für dieses Subnetz existiert bereits ein Pool")
    pool = await get_pool(new_id)
    assert pool is not None
    return pool


async def update_pool(
    pool_id: int, body: IpPoolUpdateRequest, updated_by: str
) -> Optional[IpPoolResponse]:
    payload = _payload(body)
    payload["id"] = pool_id
    payload["updated_at"] = _now_iso()
    async with get_db() as db:
        try:
            result = await db.execute(
                text(
                    "UPDATE ip_pools SET kind=:kind, network_name=:network_name, "
                    "node=:node, vlan_tag=:vlan_tag, cidr=:cidr, gateway=:gateway, dns=:dns, "
                    "range_start=:range_start, range_end=:range_end, description=:description, "
                    "updated_at=:updated_at WHERE id=:id"
                ),
                payload,
            )
            if result.rowcount == 0:
                await db.rollback()
                return None
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Für dieses Subnetz existiert bereits ein Pool")
    return await get_pool(pool_id)


async def delete_pool(pool_id: int) -> bool:
    async with get_db() as db:
        result = await db.execute(
            text("DELETE FROM ip_pools WHERE id = :id"), {"id": pool_id}
        )
        await db.commit()
    return result.rowcount > 0


# ── best-effort Free-IP (zustandslos) ─────────────────────────────────────────

def compute_free_ip(pool: IpPoolResponse, used: set[str]) -> Optional[str]:
    """Niedrigste freie IP im Pool: innerhalb cidr/range, nicht Netz-/Broadcast-/
    Gateway-Adresse und nicht in ``used``. `ip_network.hosts()` schließt Netz- und
    Broadcast-Adresse bereits aus (bei /31 + /32 gibt es keine → beide/eine nutzbar).
    """
    net = ipaddress.ip_network(pool.cidr, strict=False)
    gw = ipaddress.ip_address(pool.gateway) if pool.gateway else None
    lo = ipaddress.ip_address(pool.range_start) if pool.range_start else None
    hi = ipaddress.ip_address(pool.range_end) if pool.range_end else None
    for host in net.hosts():
        if lo is not None and host < lo:
            continue
        if hi is not None and host > hi:
            continue
        if gw is not None and host == gw:
            continue
        if str(host) in used:
            continue
        return str(host)
    return None


async def suggest_free_ip(pool_id: int, used: set[str]) -> Optional[SuggestResponse]:
    """best-effort Vorschlag gegen die aktuell live belegten IPs. Gibt None, wenn
    der Pool nicht existiert (Router → 404)."""
    pool = await get_pool(pool_id)
    if pool is None:
        return None
    # nur belegte IPs innerhalb des Pool-cidr sind relevant
    net = ipaddress.ip_network(pool.cidr, strict=False)
    used_in_net = {ip for ip in used if _ip_in_net(ip, net)}
    ip = compute_free_ip(pool, used_in_net)
    return SuggestResponse(
        pool_id=pool_id,
        ip=ip,
        best_effort=True,
        reason=None if ip else "pool_exhausted",
    )


def _ip_in_net(ip: str, net: ipaddress.IPv4Network) -> bool:
    try:
        return ipaddress.ip_address(ip) in net
    except ValueError:
        return False
