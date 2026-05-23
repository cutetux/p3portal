// p3portal.org
import api from './client'

export async function fetchAnnouncements() {
  const { data } = await api.get('/api/announcements')
  return data
}

export async function fetchAdminAnnouncements() {
  const { data } = await api.get('/api/admin/announcements')
  return data
}

export async function createAnnouncement(payload) {
  const { data } = await api.post('/api/admin/announcements', payload)
  return data
}

export async function updateAnnouncement(id, payload) {
  const { data } = await api.put(`/api/admin/announcements/${id}`, payload)
  return data
}

export async function deleteAnnouncement(id) {
  await api.delete(`/api/admin/announcements/${id}`)
}
