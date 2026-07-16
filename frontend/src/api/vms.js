// p3portal.org
import api from './client'

// Multi-Node disambiguation: when the caller knows which Proxmox node hosts
// the VM (every dashboard listing carries `vm.node`), passing it as a query
// avoids backend fan-out and prevents VMID-collision ambiguity between
// standalone Proxmox installations.
function nodeQuery(node) {
  return node ? `?node=${encodeURIComponent(node)}` : ''
}

// PROJ-96: node + optionales confirm (Aktions-Impact-Warnung). Ohne confirm
// verhält sich der Endpoint exakt wie zuvor; confirm=true überspringt die
// Abhängigkeits-Warnung (Maschinen-Aufrufer / „Trotzdem fortfahren").
function powerQuery(node, { confirm } = {}) {
  const p = new URLSearchParams()
  if (node) p.set('node', node)
  if (confirm) p.set('confirm', 'true')
  const s = p.toString()
  return s ? `?${s}` : ''
}

export async function startVm(vmid, node) {
  const { data } = await api.post(`/api/vms/${vmid}/start${nodeQuery(node)}`)
  return data
}

export async function stopVm(vmid, node, opts = {}) {
  const { data } = await api.post(`/api/vms/${vmid}/stop${powerQuery(node, opts)}`)
  return data
}

export async function rebootVm(vmid, node, opts = {}) {
  const { data } = await api.post(`/api/vms/${vmid}/reboot${powerQuery(node, opts)}`)
  return data
}

export async function deleteVm(vmid, node, opts = {}) {
  const { data } = await api.delete(`/api/vms/${vmid}${powerQuery(node, opts)}`)
  return data
}

export async function updateVmConfig(vmid, updates, node) {
  await api.patch(`/api/vms/${vmid}/config${nodeQuery(node)}`, updates)
}

export async function getSnapshots(vmid, node) {
  const { data } = await api.get(`/api/vms/${vmid}/snapshots${nodeQuery(node)}`)
  return data
}

export async function createSnapshot(vmid, name, description = '', node) {
  const { data } = await api.post(`/api/vms/${vmid}/snapshots${nodeQuery(node)}`, { name, description })
  return data
}

export async function rollbackSnapshot(vmid, name, node, opts = {}) {
  const { data } = await api.post(`/api/vms/${vmid}/snapshots/${encodeURIComponent(name)}/rollback${powerQuery(node, opts)}`)
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

// ── PROJ-81: VM Disk Management (manual, Proxmox-only) ─────────────────────────

// Datastore dropdown: storages on a node that can hold VM disk images.
export async function listImageStorages(node) {
  const { data } = await api.get(`/api/nodes/${encodeURIComponent(node)}/image-storages`)
  return data
}

// Attach (= create + attach) an additional disk. Returns { disks, disk }.
export async function attachDisk(vmid, { size_gb, storage, bus }, node) {
  const { data } = await api.post(`/api/vms/${vmid}/disks${nodeQuery(node)}`, { size_gb, storage, bus })
  return data
}

// Grow an existing disk (Proxmox cannot shrink). Returns { disks, disk }.
export async function resizeDisk(vmid, disk, size_gb, node) {
  const { data } = await api.put(`/api/vms/${vmid}/disks/${encodeURIComponent(disk)}/resize${nodeQuery(node)}`, { size_gb })
  return data
}

// Detach + physically purge a disk. `confirm` must equal the VM name. Returns { disks, disk }.
export async function removeDisk(vmid, disk, confirm, node) {
  const params = new URLSearchParams({ confirm })
  if (node) params.set('node', node)
  const { data } = await api.delete(`/api/vms/${vmid}/disks/${encodeURIComponent(disk)}?${params.toString()}`)
  return data
}

// ── PROJ-102: VM/LXC Lifecycle (Clone / Migrate / Convert-to-Template) ─────────
// Alle drei Aktionen laufen als Job (202 → JobResponse) mit WebSocket-Live-Log;
// der Aufrufer navigiert danach zu /events/<job.id>.

// Storages on a node that can hold LXC rootfs volumes (LXC-Clone-Ziel-Dropdown).
export async function listRootdirStorages(node) {
  const { data } = await api.get(`/api/nodes/${encodeURIComponent(node)}/rootdir-storages`)
  return data
}

// Ziel-Nodes für die Migration = andere cluster_nodes derselben Installation.
// Leere `targets` → Single-Node → Migrate deaktiviert.
export async function getMigrationTargets(vmid, node) {
  const { data } = await api.get(`/api/vms/${vmid}/migration-targets${nodeQuery(node)}`)
  return data
}

// Clone auf dieselbe Node. body: { name, target_storage?, newid?, full, set_owner }.
export async function cloneVm(vmid, body, node) {
  const { data } = await api.post(`/api/vms/${vmid}/clone${nodeQuery(node)}`, body)
  return data
}

// Offline-Migration auf eine andere Node. body: { target_node, target_storage? }.
// PROJ-103: optionales confirm überspringt die HA-Awareness-Warnung (409 ha_managed).
export async function migrateVm(vmid, body, node, opts = {}) {
  const { data } = await api.post(`/api/vms/${vmid}/migrate${powerQuery(node, opts)}`, body)
  return data
}

// Gestoppten Gast zu einem Template konvertieren.
// PROJ-103: optionales confirm überspringt die HA-Awareness-Warnung (409 ha_managed).
export async function convertToTemplate(vmid, node, opts = {}) {
  const { data } = await api.post(`/api/vms/${vmid}/convert-template${powerQuery(node, opts)}`)
  return data
}
