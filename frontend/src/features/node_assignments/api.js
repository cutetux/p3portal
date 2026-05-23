// p3portal.org
// PROJ-47: API-Client für das Node-Assignments-Modul.
import api from '../../api/client'

const BASE = '/api/nodes'

export const nodeAssignmentsApi = {
  list: (nodeId) =>
    api.get(`${BASE}/${nodeId}/assignments`).then(r => r.data),

  add: (nodeId, payload) =>
    api.post(`${BASE}/${nodeId}/assignments`, payload).then(r => r.data),

  update: (nodeId, subjectType, subjectId, payload) =>
    api.put(`${BASE}/${nodeId}/assignments/${subjectType}/${subjectId}`, payload).then(r => r.data),

  remove: (nodeId, subjectType, subjectId) =>
    api.delete(`${BASE}/${nodeId}/assignments/${subjectType}/${subjectId}`),
}

export const myNodeAssignmentsApi = {
  list: () => api.get('/api/me/node-assignments').then(r => r.data),
}
