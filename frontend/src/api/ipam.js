// p3portal.org
import api from './client'

/**
 * PROJ-42 Phase 1 – API client for /api/ipam (Core Simple-IPAM).
 *
 * Stateless best-effort IPAM: P3 keeps IP pools bound to a network
 * (bridge/SDN-VNet) and suggests a free IP live from Proxmox. No allocation
 * store (that is Phase 2 / Plus). Pool CRUD is admin-only in Core
 * (`require_admin_or('manage_ipam')`; nobody holds manage_ipam until Plus).
 *
 * Network identity = (kind, network_name, node, vlan_tag). `node` is null for a
 * cluster-wide vnet; `vlan_tag` is null for untagged. The API carries None; the
 * backend normalises to sentinels internally.
 */

// ── Pool CRUD (admin / manage_ipam) ──────────────────────────────────────────
export async function listPools() {
  const { data } = await api.get('/api/ipam/pools')
  return data // IpPoolResponse[]
}

export async function createPool(payload) {
  const { data } = await api.post('/api/ipam/pools', payload)
  return data
}

export async function updatePool(poolId, payload) {
  const { data } = await api.put(`/api/ipam/pools/${poolId}`, payload)
  return data
}

export async function deletePool(poolId) {
  await api.delete(`/api/ipam/pools/${poolId}`)
}

// ── Deploy resolution (any non-restricted user) ──────────────────────────────
// All pools available at deploy time (Phase 1: every pool; Phase 2 filters by
// network grants). Lets the IP field offer a pool picker independent of whether
// the playbook carries a proxmox_bridge field.
export async function availablePools() {
  const { data } = await api.get('/api/ipam/pools/available')
  return data // IpPoolResponse[]
}

// Pools bound to one concrete network. Returns 0/1/>1 → field/auto/subnet-picker.
export async function poolsByNetwork({ kind, networkName, node = null, vlanTag = null }) {
  const params = { kind, network_name: networkName }
  if (node != null && node !== '') params.node = node
  if (vlanTag != null && vlanTag !== '') params.vlan_tag = vlanTag
  const { data } = await api.get('/api/ipam/pools/by-network', { params })
  return data // IpPoolResponse[]
}

// best-effort free-IP suggestion (stateless, live from Proxmox).
export async function suggestFreeIp(poolId) {
  const { data } = await api.get('/api/ipam/suggest', { params: { pool_id: poolId } })
  return data // { pool_id, ip, best_effort, reason }
}
