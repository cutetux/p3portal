// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: API-Client für das Pools-Modul.
import api from '../../api/client'

const BASE = '/api/pools'

export const poolsApi = {
  list: (params = {}) => api.get(BASE, { params }).then(r => r.data),

  get: (id) => api.get(`${BASE}/${id}`).then(r => r.data),

  create: (payload) => api.post(BASE, payload).then(r => r.data),

  update: (id, payload) => api.put(`${BASE}/${id}`, payload).then(r => r.data),

  remove: (id) => api.delete(`${BASE}/${id}`),

  getDeletePreview: (id) => api.get(`${BASE}/${id}/delete-preview`).then(r => r.data),

  getUsage: (id) => api.get(`${BASE}/${id}/usage`).then(r => r.data),

  addMember: (poolId, payload) =>
    api.post(`${BASE}/${poolId}/members`, payload).then(r => r.data),

  addMembersBulk: (poolId, members) =>
    api.post(`${BASE}/${poolId}/members:bulk`, { members }).then(r => r.data),

  removeMember: (poolId, nodeId, vmid) =>
    api.delete(`${BASE}/${poolId}/members/${nodeId}/${vmid}`),

  addAssignment: (poolId, payload) =>
    api.post(`${BASE}/${poolId}/assignments`, payload).then(r => r.data),

  removeAssignment: (poolId, subjectType, subjectId) =>
    api.delete(`${BASE}/${poolId}/assignments/${subjectType}/${subjectId}`),

  tagsPool: () => api.get(`${BASE}/tags`).then(r => r.data.tags),
}

export const myPoolsApi = {
  list: () => api.get('/api/me/pools').then(r => r.data),
}

export const vmPoolApi = {
  move: (nodeId, vmid, poolId) =>
    api.put(`/api/vms/${nodeId}/${vmid}/pool`, { pool_id: poolId ?? null }).then(r => r.data),
}
