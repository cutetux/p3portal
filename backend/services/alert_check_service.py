# p3portal.org
"""PROJ-34: State-Machine für Alert-Checks.

Wird via asyncio.create_task() vom ClusterCacheService nach jedem frischen
Proxmox-Fetch aufgerufen. Prüft alle aktiven Regeln gegen die VM-Metriken
und persistiert Zustandsänderungen.

State-Machine pro Regel+VM+Severity:
  ok → pending → warning/critical → pending_critical → critical
  Deeskalation: critical → warning (wenn nur Warning-Schwelle überschritten)
  Recovery: → ok (mit Recovery-Notification wenn notify_recovery=True)

Performance: synchron im asyncio-Loop; sollte < 100 ms bleiben.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from backend.db.database import get_db

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _encode(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value)


# ── Metric extraction ─────────────────────────────────────────────────────────

def _extract_metric(vm_data: dict, metric: str, filesystem: str | None) -> list[tuple[str | None, float | None]]:
    """Extract metric value(s) from a VM data dict.

    Returns a list of (filesystem_label, value) tuples.
    For disk_percent without a filesystem filter, returns all reported filesystems.
    For other metrics, returns [(None, value)].
    """
    if metric == "cpu_percent":
        cpu = vm_data.get("cpu")
        if cpu is not None:
            return [(None, float(cpu) * 100.0)]
        return [(None, None)]

    if metric == "mem_percent":
        mem = vm_data.get("mem")
        maxmem = vm_data.get("maxmem")
        if mem is not None and maxmem and maxmem > 0:
            return [(None, float(mem) / float(maxmem) * 100.0)]
        return [(None, None)]

    if metric == "disk_percent":
        # Try filesystem usage from QEMU agent data (available via PROJ-32)
        filesystems = vm_data.get("filesystems") or []
        if filesystems:
            results = []
            for fs_info in filesystems:
                mp = fs_info.get("mountpoint", "")
                total = fs_info.get("total_bytes", 0)
                used  = fs_info.get("used_bytes", 0)
                if total and total > 0:
                    pct = float(used) / float(total) * 100.0
                    if filesystem is None or mp == filesystem:
                        results.append((mp, pct))
            if results:
                return results
        # Fallback to disk/maxdisk
        disk = vm_data.get("disk")
        maxdisk = vm_data.get("maxdisk")
        if disk is not None and maxdisk and maxdisk > 0:
            return [(filesystem or "/", float(disk) / float(maxdisk) * 100.0)]
        return [(None, None)]

    if metric == "status":
        # critical_threshold stores the target status string (e.g. "stopped")
        status = vm_data.get("status")
        return [(None, status)]

    return [(None, None)]


def _status_triggered(current_status: str | None, target_status: Any) -> bool:
    """For status metric: alert fires when VM status matches target."""
    if current_status is None or target_status is None:
        return False
    return str(current_status).lower() == str(target_status).lower()


# ── State machine ─────────────────────────────────────────────────────────────

async def _get_state(rule_id: int, vmid: str, node_id: int, severity: str) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text(
                """SELECT id, state, pending_count, last_value, last_changed_at
                   FROM alert_states
                   WHERE rule_id = :rule_id AND vmid = :vmid AND node_id = :node_id AND severity = :severity"""
            ),
            {"rule_id": rule_id, "vmid": vmid, "node_id": node_id, "severity": severity},
        )
        row = result.mappings().fetchone()
    return dict(row) if row else None


async def _upsert_state(
    rule_id: int,
    vmid: str,
    node_id: int,
    severity: str,
    state: str,
    pending_count: int,
    last_value: Any,
) -> None:
    now = _now()
    async with get_db() as session:
        existing = await session.execute(
            text(
                """SELECT id FROM alert_states
                   WHERE rule_id = :rule_id AND vmid = :vmid AND node_id = :node_id AND severity = :severity"""
            ),
            {"rule_id": rule_id, "vmid": vmid, "node_id": node_id, "severity": severity},
        )
        row = existing.fetchone()
        if row:
            await session.execute(
                text(
                    """UPDATE alert_states
                       SET state = :state, pending_count = :pending_count,
                           last_value = :last_value, last_checked_at = :now,
                           last_changed_at = CASE WHEN state != :state THEN :now ELSE last_changed_at END
                       WHERE rule_id = :rule_id AND vmid = :vmid AND node_id = :node_id AND severity = :severity"""
                ),
                {
                    "state": state,
                    "pending_count": pending_count,
                    "last_value": _encode(last_value),
                    "now": now,
                    "rule_id": rule_id,
                    "vmid": vmid,
                    "node_id": node_id,
                    "severity": severity,
                },
            )
        else:
            await session.execute(
                text(
                    """INSERT INTO alert_states
                       (rule_id, vmid, node_id, severity, state, pending_count,
                        last_value, last_checked_at, last_changed_at)
                       VALUES (:rule_id, :vmid, :node_id, :severity, :state, :pending_count,
                               :last_value, :now, :now)"""
                ),
                {
                    "rule_id": rule_id,
                    "vmid": vmid,
                    "node_id": node_id,
                    "severity": severity,
                    "state": state,
                    "pending_count": pending_count,
                    "last_value": _encode(last_value),
                    "now": now,
                },
            )
        await session.commit()


async def _record_event(
    rule_id: int,
    rule_name: str,
    vmid: str,
    node_id: int,
    vm_name: str | None,
    metric: str,
    value: Any,
    threshold: Any,
    severity: str,
    event_state: str,
    vm_type: str = "qemu",
    proxmox_node: str = "",
) -> int:
    """Insert an alert_event row and return its id."""
    now = _now()
    async with get_db() as session:
        result = await session.execute(
            text(
                """INSERT INTO alert_events
                   (rule_id, rule_name, vmid, node_id, vm_name, vm_type, proxmox_node,
                    metric, value, threshold, severity, state, timestamp)
                   VALUES (:rule_id, :rule_name, :vmid, :node_id, :vm_name, :vm_type, :proxmox_node,
                           :metric, :value, :threshold, :severity, :state, :timestamp)
                   RETURNING id"""
            ),
            {
                "rule_id": rule_id,
                "rule_name": rule_name,
                "vmid": str(vmid),
                "node_id": node_id,
                "vm_name": vm_name,
                "vm_type": vm_type,
                "proxmox_node": proxmox_node,
                "metric": metric,
                "value": _encode(value),
                "threshold": _encode(threshold),
                "severity": severity,
                "state": event_state,
                "timestamp": now,
            },
        )
        event_id = result.fetchone()[0]
        await session.commit()
    return event_id


# ── Per-rule check ────────────────────────────────────────────────────────────

async def _check_rule(
    rule: dict,
    vm_data: dict,
    vmid: str,
    node_id: int,
    vm_name: str | None,
    is_plus: bool,
) -> None:
    """Run state-machine for one rule against one VM."""
    from backend.services import alert_notification_service

    rule_id = rule["id"]
    metric  = rule["metric"]
    fs_filter = rule.get("filesystem")
    sustained = rule.get("sustained_polls", 1)
    w_threshold = rule.get("warning_threshold")
    c_threshold = rule.get("critical_threshold")
    notify_recovery = rule.get("notify_recovery", True)
    vm_type = vm_data.get("type", "qemu")
    proxmox_node = vm_data.get("node", "")

    measurements = _extract_metric(vm_data, metric, fs_filter)

    for _fs_label, raw_value in measurements:
        # ── Determine which severities are breached ───────────────────────────
        if metric == "status":
            warning_breached  = False
            critical_breached = _status_triggered(raw_value, c_threshold)
        else:
            if raw_value is None:
                continue  # No data; keep state unchanged
            num_val = float(raw_value)
            warning_breached  = w_threshold is not None and num_val >= float(w_threshold)
            critical_breached = c_threshold is not None and num_val >= float(c_threshold)

        # ── Process warning severity ──────────────────────────────────────────
        if w_threshold is not None:
            await _process_severity(
                rule_id=rule_id,
                rule_name=rule["name"],
                vmid=vmid,
                node_id=node_id,
                vm_name=vm_name,
                metric=metric,
                raw_value=raw_value,
                threshold=w_threshold,
                severity="warning",
                breached=warning_breached,
                sustained=sustained,
                notify_recovery=notify_recovery,
                rule=rule,
                is_plus=is_plus,
                vm_type=vm_type,
                proxmox_node=proxmox_node,
            )

        # ── Process critical severity ─────────────────────────────────────────
        if c_threshold is not None or metric == "status":
            await _process_severity(
                rule_id=rule_id,
                rule_name=rule["name"],
                vmid=vmid,
                node_id=node_id,
                vm_name=vm_name,
                metric=metric,
                raw_value=raw_value,
                threshold=c_threshold,
                severity="critical",
                breached=critical_breached,
                sustained=sustained,
                notify_recovery=notify_recovery,
                rule=rule,
                is_plus=is_plus,
                vm_type=vm_type,
                proxmox_node=proxmox_node,
            )


async def _process_severity(
    rule_id: int,
    rule_name: str,
    vmid: str,
    node_id: int,
    vm_name: str | None,
    metric: str,
    raw_value: Any,
    threshold: Any,
    severity: str,
    breached: bool,
    sustained: int,
    notify_recovery: bool,
    rule: dict,
    is_plus: bool,
    vm_type: str = "qemu",
    proxmox_node: str = "",
) -> None:
    from backend.services import alert_notification_service

    state_row = await _get_state(rule_id, vmid, node_id, severity)
    current_state   = state_row["state"] if state_row else "ok"
    pending_count   = state_row["pending_count"] if state_row else 0

    target_state = "warning" if severity == "warning" else "critical"

    if breached:
        if current_state in ("ok", "pending"):
            new_count = pending_count + 1
            if new_count >= sustained:
                # Transition to firing
                new_state = target_state
                await _upsert_state(rule_id, vmid, node_id, severity, new_state, new_count, raw_value)
                event_id = await _record_event(
                    rule_id, rule_name, vmid, node_id, vm_name,
                    metric, raw_value, threshold, severity, "firing",
                    vm_type=vm_type, proxmox_node=proxmox_node,
                )
                # Dispatch notification
                import asyncio
                asyncio.ensure_future(
                    alert_notification_service.dispatch(
                        rule=rule,
                        event_id=event_id,
                        vmid=vmid,
                        vm_name=vm_name,
                        metric=metric,
                        value=raw_value,
                        threshold=threshold,
                        severity=severity,
                        event_state="firing",
                        is_plus=is_plus,
                    )
                )
            else:
                await _upsert_state(rule_id, vmid, node_id, severity, "pending", new_count, raw_value)
        else:
            # Already firing; just update value (no re-notification)
            await _upsert_state(rule_id, vmid, node_id, severity, target_state, pending_count, raw_value)
    else:
        if current_state in (target_state, "pending"):
            # Recovery
            await _upsert_state(rule_id, vmid, node_id, severity, "ok", 0, raw_value)
            if current_state == target_state and notify_recovery:
                event_id = await _record_event(
                    rule_id, rule_name, vmid, node_id, vm_name,
                    metric, raw_value, threshold, severity, "resolved",
                    vm_type=vm_type, proxmox_node=proxmox_node,
                )
                import asyncio
                asyncio.ensure_future(
                    alert_notification_service.dispatch(
                        rule=rule,
                        event_id=event_id,
                        vmid=vmid,
                        vm_name=vm_name,
                        metric=metric,
                        value=raw_value,
                        threshold=threshold,
                        severity=severity,
                        event_state="resolved",
                        is_plus=is_plus,
                    )
                )
        else:
            # Already ok; reset pending counter if needed
            if pending_count != 0:
                await _upsert_state(rule_id, vmid, node_id, severity, "ok", 0, raw_value)


# ── Main entry point (called by ClusterCacheService callback) ─────────────────

async def check_node(node_id: int, vms_data: list[dict]) -> None:
    """Check all alert rules for all VMs on a given portal node.

    Called fire-and-forget from ClusterCacheService on_fresh_data callback.
    vms_data: list of VM dicts from Proxmox resources endpoint.
    """
    from backend.services.alert_rule_service import get_effective_rules
    from backend.core.plus_protocol import plus_behavior

    try:
        is_plus = plus_behavior.can_use_alert_presets()
    except Exception:
        is_plus = False

    if not vms_data:
        return

    for vm_data in vms_data:
        vmid_raw = vm_data.get("vmid")
        if vmid_raw is None:
            continue
        vmid    = str(vmid_raw)
        vm_name = vm_data.get("name") or vmid
        vm_type = vm_data.get("type", "qemu")

        # Skip templates
        if vm_data.get("template"):
            continue

        try:
            effective_rules = await get_effective_rules(vmid, node_id, is_plus)
        except Exception as exc:
            logger.debug("Alert rule fetch failed for VM %s: %s", vmid, exc)
            continue

        for rule in effective_rules:
            if not rule.get("enabled"):
                continue
            try:
                await _check_rule(rule, vm_data, vmid, node_id, vm_name, is_plus)
            except Exception as exc:
                logger.warning(
                    "Alert check failed for rule %s / VM %s: %s",
                    rule.get("id"), vmid, exc,
                )
