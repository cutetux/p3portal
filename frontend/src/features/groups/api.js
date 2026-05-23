// p3portal.org
// PROJ-45: API-Client für das Groups-Modul.
import api from '../../api/client'

const BASE = '/api/groups'

export const groupsApi = {
  list: (params = {}) => api.get(BASE, { params }).then(r => r.data),

  get: (id) => api.get(`${BASE}/${id}`).then(r => r.data),

  create: (payload) => api.post(BASE, payload).then(r => r.data),

  update: (id, payload) => api.put(`${BASE}/${id}`, payload).then(r => r.data),

  remove: (id) => api.delete(`${BASE}/${id}`),

  addMember: (groupId, userId) =>
    api.post(`${BASE}/${groupId}/members`, { user_id: userId }).then(r => r.data),

  removeMember: (groupId, userId) =>
    api.delete(`${BASE}/${groupId}/members/${userId}`),

  tagsPool: () => api.get(`${BASE}/tags`).then(r => r.data.tags),
}
