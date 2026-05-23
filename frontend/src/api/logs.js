// p3portal.org
import api from './client'

export async function getAuditLogs({ limit = 100, offset = 0, event_type, username } = {}) {
  const params = { limit, offset }
  if (event_type) params.event_type = event_type
  if (username) params.username = username
  const { data } = await api.get('/api/admin/logs', { params })
  return data
}

export async function getProxmoxAuditLog() {
  const { data } = await api.get('/api/admin/proxmox-audit')
  return data
}
