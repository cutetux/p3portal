// p3portal.org
import api from './client'

export async function fetchUsers() {
  const { data } = await api.get('/api/admin/users')
  return data
}

export async function createUser(payload) {
  const { data } = await api.post('/api/admin/users', payload)
  return data
}

export async function updateUser(id, payload) {
  const { data } = await api.patch(`/api/admin/users/${id}`, payload)
  return data
}

export async function deleteUser(id, ownershipAction = null, transferToId = null) {
  const params = {}
  if (ownershipAction) params.ownership_action = ownershipAction
  if (transferToId != null) params.ownership_transfer_to = transferToId
  await api.delete(`/api/admin/users/${id}`, { params })
}

export async function resetUserPassword(id, newPassword) {
  const { data } = await api.post(`/api/admin/users/${id}/reset-password`, {
    new_password: newPassword,
  })
  return data
}

export async function getVmidRange() {
  const { data } = await api.get('/api/admin/settings/packer-vmid-range')
  return data
}

export async function setVmidRange(min, max) {
  await api.put('/api/admin/settings/packer-vmid-range', { min, max })
}

export async function getPackerHttpIp() {
  const { data } = await api.get('/api/admin/settings/packer-http-ip')
  return data
}

export async function setPackerHttpIp(packer_http_ip) {
  await api.put('/api/admin/settings/packer-http-ip', { packer_http_ip })
}

export async function getPlaybookVmidRange() {
  const { data } = await api.get('/api/admin/settings/playbook-vmid-range')
  return data
}

export async function setPlaybookVmidRange(min, max) {
  await api.put('/api/admin/settings/playbook-vmid-range', { min, max })
}

export async function getNodeDefaultTemplates() {
  const { data } = await api.get('/api/admin/settings/node-default-templates')
  return data
}

export async function setNodeDefaultTemplates(defaults) {
  await api.put('/api/admin/settings/node-default-templates', { defaults })
}

export async function getNodeDefaultStorages() {
  const { data } = await api.get('/api/admin/settings/node-default-storages')
  return data
}

export async function setNodeDefaultStorages(defaults) {
  await api.put('/api/admin/settings/node-default-storages', { defaults })
}

export async function setPortalPermissions(id, portalPermissions) {
  const { data } = await api.put(`/api/admin/users/${id}/portal-permissions`, {
    portal_permissions: portalPermissions,
  })
  return data
}

export async function getProxmoxLoginEnabled() {
  const { data } = await api.get('/api/admin/proxmox-login')
  return data.enabled
}

export async function setProxmoxLoginEnabled(enabled) {
  await api.put('/api/admin/proxmox-login', { enabled })
}
