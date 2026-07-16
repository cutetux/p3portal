// p3portal.org
import api from './client'

/**
 * PROJ-103: API client for /api/ha (HA groups, resources, status, runtime actions).
 *
 * HA is datacenter-wide *within one Proxmox installation* (like SDN, PROJ-80). The
 * optional `node` argument is a portal node id selecting which installation to
 * target; omit it for single-installation setups (the backend falls back to the
 * default node). Proxmox is the single source of truth – no DB, last writer wins.
 * Read endpoints never 500; they return availability flags
 * (ha_unavailable / permission_denied / cluster_unreachable / detail).
 *
 * Config CRUD (groups/resources) is synchronous. Runtime actions (migrate/relocate)
 * return a Job (202) whose live-log is streamed via /events/:id.
 */

// Build axios config carrying the optional ?node=<portal_node_id>.
function cfg(node) {
  return node != null ? { params: { node } } : {}
}

// ── Status ───────────────────────────────────────────────────────────────────
export async function getHaStatus(node) {
  const { data } = await api.get('/api/ha/status', cfg(node))
  return data // { quorate, manager_node, manager_status, nodes, resources, ha_unavailable, ... }
}

// ── Rules (PVE 9; replaces HA groups) ────────────────────────────────────────
// node-affinity (ersetzt Gruppen: Nodes+Prio+strict) und resource-affinity
// (positive/negative). Regel-Löschen verwaist nichts → kein Usage-Check mehr.
export async function listHaRules(node) {
  const { data } = await api.get('/api/ha/rules', cfg(node))
  return data // { items, ha_unavailable, permission_denied, cluster_unreachable, detail }
}

export async function createHaRule(payload, node) {
  const { data } = await api.post('/api/ha/rules', payload, cfg(node))
  return data // { id }
}

export async function updateHaRule(rule, payload, node) {
  const { data } = await api.put(`/api/ha/rules/${encodeURIComponent(rule)}`, payload, cfg(node))
  return data
}

export async function deleteHaRule(rule, node) {
  await api.delete(`/api/ha/rules/${encodeURIComponent(rule)}`, cfg(node))
}

// ── Resources ────────────────────────────────────────────────────────────────
export async function listHaResources(node) {
  const { data } = await api.get('/api/ha/resources', cfg(node))
  return data // { items, ... }
}

export async function createHaResource(payload, node) {
  const { data } = await api.post('/api/ha/resources', payload, cfg(node))
  return data // { id }
}

export async function updateHaResource(sid, payload, node) {
  const { data } = await api.put(`/api/ha/resources/${encodeURIComponent(sid)}`, payload, cfg(node))
  return data
}

export async function deleteHaResource(sid, node) {
  await api.delete(`/api/ha/resources/${encodeURIComponent(sid)}`, cfg(node))
}

// ── Runtime actions (job + live-log) ─────────────────────────────────────────
export async function migrateHaResource(sid, targetNode, node) {
  const { data } = await api.post(
    `/api/ha/resources/${encodeURIComponent(sid)}/migrate`, { node: targetNode }, cfg(node),
  )
  return data // JobResponse
}

export async function relocateHaResource(sid, targetNode, node) {
  const { data } = await api.post(
    `/api/ha/resources/${encodeURIComponent(sid)}/relocate`, { node: targetNode }, cfg(node),
  )
  return data // JobResponse
}
