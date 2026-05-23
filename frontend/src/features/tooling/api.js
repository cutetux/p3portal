// p3portal.org
// PROJ-66: Tooling-Health API-Client
import api from '../../api/client'

export async function fetchToolingStatus() {
  const { data } = await api.get('/api/system/tooling/status')
  return data
}

export async function postToolingRecheck() {
  const { data } = await api.post('/api/system/tooling/recheck')
  return data
}

export async function fetchToolingAuditHistory(tool, limit = 20) {
  const { data } = await api.get('/api/system/tooling/audit-history', {
    params: { tool, limit },
  })
  return data
}
