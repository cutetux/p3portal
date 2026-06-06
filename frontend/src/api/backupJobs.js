// p3portal.org
import api from './client'

/**
 * PROJ-78: API client for /api/backup-jobs
 * All operations require ?node=<proxmox_node> to identify the Proxmox installation.
 */

export async function listBackupJobs(node) {
  const { data } = await api.get('/api/backup-jobs', { params: { node } })
  return data // { jobs, permission_denied, node_unreachable }
}

export async function listBackupJobPools(node) {
  const { data } = await api.get('/api/backup-jobs/pools', { params: { node } })
  return data // [{ poolid, comment? }, ...]
}

export async function listBackupJobStorages(node) {
  const { data } = await api.get('/api/backup-jobs/storages', { params: { node } })
  return data // [{ storage, type, content, ... }, ...]
}

export async function createBackupJob(node, payload) {
  const { data } = await api.post('/api/backup-jobs', payload, { params: { node } })
  return data
}

export async function updateBackupJob(node, jobId, payload) {
  await api.put(`/api/backup-jobs/${jobId}`, payload, { params: { node } })
}

export async function deleteBackupJob(node, jobId) {
  await api.delete(`/api/backup-jobs/${jobId}`, { params: { node } })
}

export async function runBackupNow(node, jobId) {
  const { data } = await api.post(`/api/backup-jobs/${jobId}/run`, {}, { params: { node } })
  return data // { tasks: [{node, upid}, ...] }
}
