// p3portal.org
// PROJ-48: API-Client für das Owners-Modul.
import api from '../../api/client'

const BASE = '/api/owners'

export const ownersApi = {
  // Eigene Ownerships des eingeloggten Users (Cross-cutting endpoint: /api/me/owners)
  listMine: () => api.get('/api/me/owners').then(r => r.data),

  // Alle Owner einer einzelnen Ressource
  listForResource: (resourceType, nodeId, vmid) =>
    api.get(`${BASE}/${resourceType}/${nodeId}/${vmid}`).then(r => r.data),

  // Bulk-Lookup: mehrere Ressourcen auf einmal
  bulk: (resources) =>
    api.post(`${BASE}/bulk`, { resources }).then(r => r.data),

  // Co-Owner hinzufügen
  add: (resourceType, nodeId, vmid, userId) =>
    api.post(`${BASE}/${resourceType}/${nodeId}/${vmid}`, { user_id: userId }).then(r => r.data),

  // Owner entfernen (optional: orphan=true für letzten Owner)
  remove: (resourceType, nodeId, vmid, userId, orphan = false) =>
    api.delete(`${BASE}/${resourceType}/${nodeId}/${vmid}/${userId}${orphan ? '?orphan=true' : ''}`),

  // Eigentum übertragen
  transfer: (resourceType, nodeId, vmid, toUserId) =>
    api.post(`${BASE}/${resourceType}/${nodeId}/${vmid}/transfer`, { to_user_id: toUserId }).then(r => r.data),

  // Externe VM adoptieren (Admin-only bis PROJ-50)
  adopt: (resourceType, nodeId, vmid) =>
    api.post(`${BASE}/${resourceType}/${nodeId}/${vmid}/adopt`).then(r => r.data),

  // Löschantrag stellen (PROJ-50-Stub)
  deleteRequest: (resourceType, nodeId, vmid, reason = '') =>
    api.post(`${BASE}/${resourceType}/${nodeId}/${vmid}/delete-request`, { reason }).then(r => r.data),

  // Owner-Konfig (owner_auto_assign_enabled + categories)
  getConfig: () => api.get(`${BASE}/config`).then(r => r.data),
}
