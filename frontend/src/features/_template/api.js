// p3portal.org
// PROJ-XX: API-Client für das FEATURE-Modul.
// Axios-Wrapper – JWT-Interceptor kommt von src/api/client.js
import api from '../../api/client';

const BASE = '/api/features';

export const featuresApi = {
  list: () => api.get(BASE).then(r => r.data),

  get: (id) => api.get(`${BASE}/${id}`).then(r => r.data),

  create: (payload) => api.post(BASE, payload).then(r => r.data),

  update: (id, payload) => api.put(`${BASE}/${id}`, payload).then(r => r.data),

  remove: (id) => api.delete(`${BASE}/${id}`).then(r => r.data),
};
