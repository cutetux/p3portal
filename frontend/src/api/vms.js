// p3portal.org
import api from './client'

// Multi-Node disambiguation: when the caller knows which Proxmox node hosts
// the VM (every dashboard listing carries `vm.node`), passing it as a query
// avoids backend fan-out and prevents VMID-collision ambiguity between
// standalone Proxmox installations.
function nodeQuery(node) {
  return node ? `?node=${encodeURIComponent(node)}` : ''
}

export async function startVm(vmid, node) {
  const { data } = await api.post(`/api/vms/${vmid}/start${nodeQuery(node)}`)
  return data
}

export async function stopVm(vmid, node) {
  const { data } = await api.post(`/api/vms/${vmid}/stop${nodeQuery(node)}`)
  return data
}

export async function rebootVm(vmid, node) {
  const { data } = await api.post(`/api/vms/${vmid}/reboot${nodeQuery(node)}`)
  return data
}

export async function deleteVm(vmid, node) {
  const { data } = await api.delete(`/api/vms/${vmid}${nodeQuery(node)}`)
  return data
}

export async function getSnapshots(vmid, node) {
  const { data } = await api.get(`/api/vms/${vmid}/snapshots${nodeQuery(node)}`)
  return data
}

export async function createSnapshot(vmid, name, description = '', node) {
  const { data } = await api.post(`/api/vms/${vmid}/snapshots${nodeQuery(node)}`, { name, description })
  return data
}

export async function rollbackSnapshot(vmid, name, node) {
  const { data } = await api.post(`/api/vms/${vmid}/snapshots/${encodeURIComponent(name)}/rollback${nodeQuery(node)}`)
  return data
}

export async function deleteSnapshot(vmid, name, node) {
  const { data } = await api.delete(`/api/vms/${vmid}/snapshots/${encodeURIComponent(name)}${nodeQuery(node)}`)
  return data
}

export async function getVmIp(node, vmid, type) {
  const { data } = await api.get(`/api/vms/${node}/${vmid}/ip?type=${type}`)
  return data
}

export async function checkVmSsh(node, vmid, ip) {
  const { data } = await api.get(`/api/vms/${node}/${vmid}/ssh-check?ip=${encodeURIComponent(ip)}`)
  return data
}

export async function getServiceAccountStatus() {
  const { data } = await api.get('/api/service-accounts/status')
  return data
}

// ── PROJ-29: VM Detail Page ───────────────────────────────────────────────────

export async function getVmDetail(node, vmType, vmid) {
  const { data } = await api.get(`/api/cluster/vms/${node}/${vmType}/${vmid}`)
  return data
}

export async function getVmBackups(node, vmType, vmid) {
  const { data } = await api.get(`/api/cluster/vms/${node}/${vmType}/${vmid}/backups`)
  return data
}

export async function createVmBackup(node, vmType, vmid, storage, mode, compress) {
  const { data } = await api.post(`/api/cluster/vms/${node}/${vmType}/${vmid}/backup`, { storage, mode, compress })
  return data
}

export async function deleteVmBackup(node, vmType, vmid, volid, storage) {
  await api.delete(`/api/cluster/vms/${node}/${vmType}/${vmid}/backup`, { data: { volid, storage } })
}

// ── PROJ-32: Guest-Info & LXC-Interfaces ──────────────────────────────────────

export async function getVmGuestInfo(node, vmid) {
  const { data } = await api.get(`/api/cluster/vms/${node}/qemu/${vmid}/guest-info`)
  return data
}

export async function getLxcInterfaces(node, vmid) {
  const { data } = await api.get(`/api/cluster/vms/${node}/lxc/${vmid}/interfaces`)
  return data
}
