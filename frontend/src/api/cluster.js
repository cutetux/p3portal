// p3portal.org
import api from './client'

export async function getNodes(force = false) {
  const { data } = await api.get('/api/cluster/nodes', force ? { params: { force: true } } : {})
  return data
}

export async function getVms(force = false) {
  const { data } = await api.get('/api/cluster/vms', force ? { params: { force: true } } : {})
  return data
}

export async function getClusterStatus(force = false) {
  const { data } = await api.get('/api/cluster/status', force ? { params: { force: true } } : {})
  return data
}

export async function getCacheStats() {
  const { data } = await api.get('/api/cluster/cache-stats')
  return data
}

export async function getProxmoxTemplates() {
  const { data } = await api.get('/api/cluster/templates')
  return data
}

export async function getPlaybookNextVmid() {
  const { data } = await api.get('/api/cluster/next-vmid')
  return data
}

// PROJ-36: Node detail
export async function getNodeDetail(node) {
  const { data } = await api.get(`/api/cluster/nodes/${node}/detail`)
  return data
}

// PROJ-36: LXC Templates
export async function getLxcTemplates() {
  const { data } = await api.get('/api/cluster/lxc-templates')
  return data
}

export async function downloadLxcTemplate({ node, template, storage }) {
  await api.post('/api/cluster/lxc-templates/download', { node, template, storage })
}

export async function deleteLxcTemplate({ node, storage, volid }) {
  await api.delete('/api/cluster/lxc-templates', { data: { node, storage, volid } })
}

export async function getPortalNodes() {
  const { data } = await api.get('/api/cluster/portal-nodes')
  return data
}

export async function getLxcTemplateStorages(node) {
  const { data } = await api.get('/api/cluster/lxc-template-storages', { params: { node } })
  return data
}

export async function uploadLxcTemplate({ node, storage, file, onUploadProgress }) {
  const form = new FormData()
  form.append('node', node)
  form.append('storage', storage)
  form.append('file', file)
  await api.post('/api/cluster/lxc-templates/upload', form, { onUploadProgress })
}

// PROJ-40: Node tasks + backups
export async function getNodeTasks(node, { limit = 50, typefilter } = {}) {
  const params = { limit }
  if (typefilter) params.typefilter = typefilter
  const { data } = await api.get(`/api/cluster/nodes/${encodeURIComponent(node)}/tasks`, { params })
  return data
}

export async function getNodeBackups(node) {
  const { data } = await api.get(`/api/cluster/nodes/${encodeURIComponent(node)}/backups`)
  return data
}
