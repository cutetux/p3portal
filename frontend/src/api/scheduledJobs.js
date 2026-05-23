// p3portal.org
import api from './client'

export async function listScheduledJobs() {
  const { data } = await api.get('/api/scheduled-jobs')
  return data
}

export async function createScheduledJob(payload) {
  const { data } = await api.post('/api/scheduled-jobs', payload)
  return data
}

export async function getScheduledJob(id) {
  const { data } = await api.get(`/api/scheduled-jobs/${id}`)
  return data
}

export async function updateScheduledJob(id, payload) {
  const { data } = await api.put(`/api/scheduled-jobs/${id}`, payload)
  return data
}

export async function deleteScheduledJob(id) {
  await api.delete(`/api/scheduled-jobs/${id}`)
}

export async function toggleScheduledJob(id) {
  const { data } = await api.post(`/api/scheduled-jobs/${id}/toggle`)
  return data
}

export async function runScheduledJobNow(id) {
  const { data } = await api.post(`/api/scheduled-jobs/${id}/run`)
  return data
}

export async function getScheduledJobRuns(id) {
  const { data } = await api.get(`/api/scheduled-jobs/${id}/runs`)
  return data
}

// Admin settings
export async function getScheduledJobsSettings() {
  const { data } = await api.get('/api/admin/scheduled-jobs/settings')
  return data
}

export async function setHistoryLimit(limit) {
  await api.put('/api/admin/scheduled-jobs/settings/history-limit', { limit })
}

export async function setSystemSshKey(key) {
  await api.put('/api/admin/scheduled-jobs/settings/system-ssh-key', { key })
}

export async function deleteSystemSshKey() {
  await api.delete('/api/admin/scheduled-jobs/settings/system-ssh-key')
}
