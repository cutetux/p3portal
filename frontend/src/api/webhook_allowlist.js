// p3portal.org
import api from './client'

export async function fetchAllowlistEntries() {
  const { data } = await api.get('/api/webhook-allowlist')
  return data
}

export async function createAllowlistEntry(pattern, allowHttp = false) {
  const { data } = await api.post('/api/webhook-allowlist', { pattern, allow_http: allowHttp })
  return data
}

export async function deleteAllowlistEntry(id) {
  await api.delete(`/api/webhook-allowlist/${id}`)
}
