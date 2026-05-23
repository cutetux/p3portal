// p3portal.org
import api from './client'

// ── Presets ───────────────────────────────────────────────────────────────────

export async function fetchPresets() {
  const { data } = await api.get('/api/rbac/presets')
  return data
}

export async function createPreset(payload) {
  const { data } = await api.post('/api/rbac/presets', payload)
  return data
}

export async function updatePreset(id, payload) {
  const { data } = await api.put(`/api/rbac/presets/${id}`, payload)
  return data
}

export async function deletePreset(id) {
  await api.delete(`/api/rbac/presets/${id}`)
}

// ── Assignments ───────────────────────────────────────────────────────────────

export async function fetchAssignments(userId) {
  const { data } = await api.get(`/api/rbac/users/${userId}/assignments`)
  return data
}

export async function createAssignment(userId, payload) {
  const { data } = await api.post(`/api/rbac/users/${userId}/assignments`, payload)
  return data
}

export async function deleteAssignment(userId, assignmentId) {
  await api.delete(`/api/rbac/users/${userId}/assignments/${assignmentId}`)
}

// ── My Permissions ────────────────────────────────────────────────────────────

export async function fetchMyPermissions() {
  const { data } = await api.get('/api/rbac/me/permissions')
  return data
}
