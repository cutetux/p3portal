// p3portal.org
// PROJ-54: API-Client für Sidebar-Pins (Favoriten).
import api from '../../api/client'

const BASE = '/api/sidebar-pins'

export const sidebarPinsApi = {
  list: () => api.get(BASE).then(r => r.data),

  create: (payload) => api.post(BASE, payload).then(r => r.data),

  updateLabel: (id, label) =>
    api.patch(`${BASE}/${id}`, { label }).then(r => r.data),

  remove: (id) => api.delete(`${BASE}/${id}`),

  reorder: (pinIds) =>
    api.put(`${BASE}/reorder`, { pin_ids: pinIds }).then(r => r.data),
}
