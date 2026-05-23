// p3portal.org
import api from './client'

export async function fetchApiKeys() {
  const { data } = await api.get('/api/admin/api-keys')
  return data
}

export async function createApiKey(payload) {
  const { data } = await api.post('/api/admin/api-keys', payload)
  return data
}

export async function revokeApiKey(id) {
  const { data } = await api.patch(`/api/admin/api-keys/${id}/revoke`)
  return data
}

export async function deleteApiKey(id) {
  await api.delete(`/api/admin/api-keys/${id}`)
}

export async function fetchApiLogs({ keyName, scope, limit = 200 } = {}) {
  const params = new URLSearchParams()
  if (keyName) params.set('key_name', keyName)
  if (scope) params.set('scope', scope)
  params.set('limit', limit)
  const { data } = await api.get(`/api/admin/api-keys/logs?${params.toString()}`)
  return data
}
