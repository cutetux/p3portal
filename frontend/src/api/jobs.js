// p3portal.org
import api from './client'

export async function startJob(playbook, params, autoAssignOwner = false, poolId = null) {
  const body = { playbook, params, auto_assign_owner: autoAssignOwner }
  // PROJ-62: Pool-Quota-Check – pool_id nur senden wenn gesetzt
  if (poolId != null) body.pool_id = poolId
  const { data } = await api.post('/api/jobs', body)
  return data
}

export async function getJobs() {
  const { data } = await api.get('/api/jobs')
  return data
}

export async function getJob(id) {
  const { data } = await api.get(`/api/jobs/${id}`)
  return data
}

export async function getJobLog(id) {
  const { data } = await api.get(`/api/jobs/${id}/log`)
  return data
}

export async function cancelJob(id) {
  const { data } = await api.post(`/api/jobs/${id}/cancel`)
  return data
}

export function createJobLogSocket(id) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const token = sessionStorage.getItem('token')
  return new WebSocket(`${proto}://${window.location.host}/api/jobs/${id}/logs/ws?token=${token}`)
}
