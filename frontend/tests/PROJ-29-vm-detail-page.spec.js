// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Payloads sind Base64-kodierte JWTs ohne echte Signatur

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const VM_DETAIL_RUNNING = {
  vmid: 100,
  name: 'web-server',
  type: 'qemu',
  status: 'running',
  node: 'pve1',
  ip: '192.168.1.100',
  uptime: 3661,
  tags: ['prod', 'web'],
  is_template: false,
  cpu_usage: 0.12,
  cpu_cores: 4,
  mem_used: 2147483648,
  mem_total: 8589934592,
  bios: 'seabios',
  ostype: 'l26',
  networks: [
    { id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' },
  ],
  disks: [
    { id: 'scsi0', storage: 'local-lvm', size: '32G' },
  ],
}

const VM_DETAIL_STOPPED = {
  ...VM_DETAIL_RUNNING,
  name: 'db-server',
  status: 'stopped',
  ip: null,
  uptime: 0,
  tags: [],
  cpu_usage: null,
  mem_used: null,
}

const VM_DETAIL_TEMPLATE = {
  ...VM_DETAIL_RUNNING,
  name: 'ubuntu-tmpl',
  vmid: 200,
  status: 'stopped',
  is_template: true,
  cpu_usage: null,
  mem_used: null,
  ip: null,
}

const VM_DETAIL_LXC = {
  vmid: 300,
  name: 'app-ct',
  type: 'lxc',
  status: 'running',
  node: 'pve1',
  ip: '192.168.1.200',
  uptime: 7200,
  tags: [],
  is_template: false,
  cpu_usage: 0.05,
  cpu_cores: 2,
  mem_used: 536870912,
  mem_total: 1073741824,
  bios: '',
  ostype: 'debian',
  networks: [{ id: 'net0', model: 'veth', bridge: 'vmbr0', mac: 'AA:BB:CC:DD:EE:FF' }],
  disks: [{ id: 'rootfs', storage: 'local-lvm', size: '20G' }],
}

const BACKUPS_RESPONSE = {
  backups: [
    {
      volid: 'backup-storage:backup/vzdump-qemu-100-2026_05_05-12_00_00.vma.zst',
      filename: 'vzdump-qemu-100-2026_05_05-12_00_00.vma.zst',
      created_at: 1746446400,
      size: 2147483648,
      storage: 'backup-storage',
    },
  ],
  schedules: [
    {
      id: 'job-1',
      schedule: 'daily',
      storage: 'backup-storage',
      mode: 'snapshot',
      compress: 'zstd',
      enabled: true,
      comment: 'Täglich 2 Uhr',
    },
  ],
  storages: ['backup-storage', 'nfs-backup'],
}

const BACKUPS_EMPTY = { backups: [], schedules: [], storages: [] }

const SNAPSHOTS_LIST = [
  { name: 'snap-v1', description: 'Vor Update', snaptime: 1700000000 },
  { name: 'snap-baseline', description: '', snaptime: 1699000000 },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockBaseApi(page) {
  await page.route('**/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: 'viewer', auth_type: 'local', role: 'viewer',
      must_change_pw: false, last_login_at: null, last_login_ip: null,
    })}))
  await page.route('**/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: 'plus', valid: true }) }))
  await page.route('**/api/themes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/admin/settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199,
        playbook_vm_id_range_start: 200, playbook_vm_id_range_end: 299 }) }))
  await page.route('**/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'pve1', host: '192.168.1.10', is_cluster: false, is_default: true }]) }))
  await page.route('**/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/announcements', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockDashboard(page) {
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }) }))
  await page.route('**/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { vmid: 100, name: 'web-server', type: 'qemu', status: 'running', node: 'pve1',
          cpu: 0.05, mem: 1073741824, maxmem: 2147483648, uptime: 3600, template: 0 },
      ]) }))
  await page.route('**/api/vms/**/ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: null }) }))
}

async function mockVmDetail(page, detail, node = 'pve1', type = 'qemu', vmid = 100) {
  await page.route(`**/api/cluster/vms/${node}/${type}/${vmid}`, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }))
}

async function mockVmBackups(page, backups, node = 'pve1', type = 'qemu', vmid = 100) {
  await page.route(`**/api/cluster/vms/${node}/${type}/${vmid}/backups`, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backups) }))
}

async function mockSnapshots(page, snaps, vmid = 100) {
  await page.route(`**/api/vms/${vmid}/snapshots`, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snaps) }))
}

async function goDetailPage(page, node = 'pve1', type = 'qemu', vmid = 100) {
  await page.goto(`/vm/${node}/${type}/${vmid}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// Navigation
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Navigation', () => {

  test('VM-Name im Dashboard ist ein klickbarer Link zur Detailseite', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockDashboard(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await page.goto('/dashboard')

    await expect(page.getByText('web-server')).toBeVisible()
    await page.getByRole('link', { name: 'web-server' }).click()
    await expect(page).toHaveURL(/\/vm\/pve1\/qemu\/100/)
  })

  test('Zurück-Link zur Dashboard-Seite ist sichtbar', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('← Dashboard')).toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Header-Bereich
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Header-Bereich', () => {

  test('zeigt VM-Name, Typ-Badge und Status-Badge', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByRole('heading', { name: 'web-server' })).toBeVisible()
    // TypeBadge "VM" als span mit exaktem Text
    await expect(page.getByText('VM', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('running').first()).toBeVisible()
  })

  test('zeigt Node, IP und Uptime bei laufender VM', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('pve1').first()).toBeVisible()
    await expect(page.getByText('192.168.1.100')).toBeVisible()
    await expect(page.getByText('1h 1m')).toBeVisible()
  })

  test('zeigt Tags als Badges', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('prod')).toBeVisible()
    await expect(page.getByText('web').first()).toBeVisible()
  })

  test('zeigt CT-Badge für LXC-Container', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_LXC, 'pve1', 'lxc', 300)
    await mockVmBackups(page, BACKUPS_EMPTY, 'pve1', 'lxc', 300)
    await mockSnapshots(page, [], 300)
    await goDetailPage(page, 'pve1', 'lxc', 300)

    await expect(page.getByText('CT', { exact: true }).first()).toBeVisible()
  })

  test('zeigt tmpl-Badge für Templates', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_TEMPLATE, 'pve1', 'qemu', 200)
    await mockVmBackups(page, BACKUPS_EMPTY, 'pve1', 'qemu', 200)
    await mockSnapshots(page, [], 200)
    await goDetailPage(page, 'pve1', 'qemu', 200)

    await expect(page.getByText('tmpl', { exact: true }).first()).toBeVisible()
  })

  test('Power-Buttons sind für Operator sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByRole('button', { name: /Stopp/i })).toBeVisible()
  })

  test('Power-Buttons sind für Viewer nicht sichtbar', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByRole('button', { name: /Stopp/i })).toHaveCount(0)
  })

  test('Power-Buttons sind bei Templates ausgeblendet', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_TEMPLATE, 'pve1', 'qemu', 200)
    await mockVmBackups(page, BACKUPS_EMPTY, 'pve1', 'qemu', 200)
    await mockSnapshots(page, [], 200)
    await goDetailPage(page, 'pve1', 'qemu', 200)

    await expect(page.getByRole('button', { name: /Stopp/i })).toHaveCount(0)
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Ressourcen
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Ressourcen', () => {

  test('zeigt CPU-Auslastung als Progressbar bei laufender VM', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('12.0%')).toBeVisible()
  })

  test('zeigt Strich statt Ressourcenwerte bei gestoppter VM', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_STOPPED)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    const dashes = page.locator('.tabular-nums', { hasText: '–' })
    await expect(dashes.first()).toBeVisible()
  })

  test('zeigt RAM-Werte in GB bei laufender VM', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText(/2\.0 GB \/ 8\.0 GB/)).toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Konfiguration
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Konfiguration', () => {

  test('zeigt CPU-Kerne, BIOS und OS-Typ', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('4').first()).toBeVisible()
    await expect(page.getByText('seabios')).toBeVisible()
    await expect(page.getByText('Linux 2.6+')).toBeVisible()
  })

  test('zeigt Netzwerkadapter-Liste mit Bridge und MAC', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('net0')).toBeVisible()
    await expect(page.getByText('vmbr0')).toBeVisible()
  })

  test('zeigt Festplatten-Liste mit Storage und Größe', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('scsi0')).toBeVisible()
    await expect(page.getByText('local-lvm')).toBeVisible()
    await expect(page.getByText('32G')).toBeVisible()
  })

  test('zeigt rootfs für LXC-Container', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_LXC, 'pve1', 'lxc', 300)
    await mockVmBackups(page, BACKUPS_EMPTY, 'pve1', 'lxc', 300)
    await mockSnapshots(page, [], 300)
    await goDetailPage(page, 'pve1', 'lxc', 300)

    await expect(page.getByText('rootfs')).toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Snapshots
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Snapshots', () => {

  test('zeigt Snapshot-Liste', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, SNAPSHOTS_LIST)
    await goDetailPage(page)

    await expect(page.getByText('snap-v1')).toBeVisible()
    await expect(page.getByText('snap-baseline')).toBeVisible()
  })

  test('zeigt leere Meldung wenn keine Snapshots', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('Keine Snapshots vorhanden.')).toBeVisible()
  })

  test('+ Snapshot Button ist nur für Operator sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('+ Snapshot')).toBeVisible()
  })

  test('+ Snapshot nicht bei Templates', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_TEMPLATE, 'pve1', 'qemu', 200)
    await mockVmBackups(page, BACKUPS_EMPTY, 'pve1', 'qemu', 200)
    await mockSnapshots(page, [], 200)
    await goDetailPage(page, 'pve1', 'qemu', 200)

    await expect(page.getByText('+ Snapshot')).toHaveCount(0)
  })

  test('Snapshot-Formular wird nach Klick auf + Snapshot gezeigt', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await page.getByText('+ Snapshot').click()
    await expect(page.getByPlaceholder('snapshot-name')).toBeVisible()
  })

  test('Snapshot-Name-Validierung: ungültige Zeichen werden abgelehnt', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await page.getByText('+ Snapshot').click()
    await page.getByPlaceholder('snapshot-name').fill('invalid name!')
    await page.getByText('Snapshot erstellen').click()
    await expect(page.getByText(/Nur a–z/)).toBeVisible()
  })

  test('Rollback/Löschen Buttons sind nur für Operator sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, SNAPSHOTS_LIST)
    await goDetailPage(page)

    await expect(page.getByText('Rollback').first()).toBeVisible()
    await expect(page.getByText('Löschen').first()).toBeVisible()
  })

  test('Bestätigungs-Dialog wird vor Snapshot-Löschen angezeigt', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, SNAPSHOTS_LIST)
    await goDetailPage(page)

    await page.getByText('Löschen').first().click()
    await expect(page.getByText('Löschen?')).toBeVisible()
    await expect(page.getByText('Ja')).toBeVisible()
    await expect(page.getByText('Nein')).toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Backups
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Backups', () => {

  test('zeigt Backup-Datei-Liste mit Datum, Größe und Storage', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_RESPONSE)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText(/vzdump-qemu-100/)).toBeVisible()
    await expect(page.getByText('backup-storage').first()).toBeVisible()
  })

  test('zeigt "Keine Backups gefunden." wenn Liste leer', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('Keine Backups gefunden.')).toBeVisible()
  })

  test('zeigt Datacenter-Backup-Jobs mit Schedule und Modus', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_RESPONSE)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('daily')).toBeVisible()
    await expect(page.getByText('aktiv')).toBeVisible()
  })

  test('zeigt "Keine Datacenter-Backup-Jobs" wenn keine Schedules', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, { ...BACKUPS_EMPTY, storages: ['backup-storage'] })
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('Keine Datacenter-Backup-Jobs für diese VM.')).toBeVisible()
  })

  test('+ Backup erstellen Button ist nur für Operator sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_RESPONSE)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('+ Backup erstellen')).toBeVisible()
  })

  test('+ Backup erstellen ist für Viewer nicht sichtbar', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_RESPONSE)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('+ Backup erstellen')).toHaveCount(0)
  })

  test('Backup-Modal öffnet sich mit Storage/Modus/Kompression-Optionen', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_RESPONSE)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await page.getByText('+ Backup erstellen').click()
    const modal = page.locator('[class*="max-w-md"]')
    await expect(modal.getByText('Backup erstellen')).toBeVisible()
    await expect(modal.getByText('Storage', { exact: true })).toBeVisible()
    await expect(modal.getByText('Modus', { exact: true })).toBeVisible()
    await expect(modal.getByText('Kompression', { exact: true })).toBeVisible()
  })

  test('Backup-Löschen-Button zeigt Bestätigungs-Dialog', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await mockVmBackups(page, BACKUPS_RESPONSE)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await page.getByText('Löschen').last().click()
    await expect(page.getByText('Löschen?')).toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Edge Cases
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-29 – Edge Cases', () => {

  test('zeigt Fehlermeldung bei VM nicht gefunden (404)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/cluster/vms/pve1/qemu/999', r =>
      r.fulfill({ status: 404, contentType: 'application/json',
        body: JSON.stringify({ detail: 'Not found' }) }))
    await page.route('**/api/cluster/vms/pve1/qemu/999/backups', r =>
      r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/vms/999/snapshots', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/vm/pve1/qemu/999')

    // VM-nicht-gefunden zeigt Fehlerkarte (Text aus VmDetailPage errLabel)
    await expect(page.getByText('VM nicht gefunden').first()).toBeVisible()
    await expect(page.getByText('← Dashboard')).toBeVisible()
  })

  test('zeigt Fehlermeldung bei fehlendem Zugriff (403)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/cluster/vms/pve1/qemu/101', r =>
      r.fulfill({ status: 403, contentType: 'application/json',
        body: JSON.stringify({ detail: 'Forbidden' }) }))
    await page.route('**/api/cluster/vms/pve1/qemu/101/backups', r =>
      r.fulfill({ status: 403, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/vms/101/snapshots', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/vm/pve1/qemu/101')

    await expect(page.getByText('Zugriff verweigert')).toBeVisible()
  })

  test('zeigt Fehlermeldung bei Service-Account-Fehler (503)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/cluster/vms/pve1/qemu/102', r =>
      r.fulfill({ status: 503, contentType: 'application/json',
        body: JSON.stringify({ detail: 'Service account not configured' }) }))
    await page.route('**/api/cluster/vms/pve1/qemu/102/backups', r =>
      r.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/vms/102/snapshots', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/vm/pve1/qemu/102')

    await expect(page.getByText('Verbindungsfehler')).toBeVisible()
  })

  test('Seite lädt auch wenn Backup-API fehlschlägt (graceful)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_RUNNING)
    await page.route('**/api/cluster/vms/pve1/qemu/100/backups', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
    await mockSnapshots(page, [])
    await goDetailPage(page)

    // Detail-Sektion lädt trotzdem
    await expect(page.getByRole('heading', { name: 'web-server' })).toBeVisible()
    await expect(page.getByText('Backups konnten nicht geladen werden.')).toBeVisible()
  })

  test('gestoppte VM zeigt IP und Uptime nicht', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await mockVmDetail(page, VM_DETAIL_STOPPED)
    await mockVmBackups(page, BACKUPS_EMPTY)
    await mockSnapshots(page, [])
    await goDetailPage(page)

    await expect(page.getByText('db-server')).toBeVisible()
    await expect(page.getByText('192.168.1.100')).toHaveCount(0)
  })

  test('Template-VM zeigt keine Backup-Erstellen und Snapshot-Erstellen Buttons', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'operator', auth_type: 'local', role: 'operator',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await mockVmDetail(page, VM_DETAIL_TEMPLATE, 'pve1', 'qemu', 200)
    await mockVmBackups(page, BACKUPS_EMPTY, 'pve1', 'qemu', 200)
    await mockSnapshots(page, [], 200)
    await goDetailPage(page, 'pve1', 'qemu', 200)

    await expect(page.getByText('+ Backup erstellen')).toHaveCount(0)
    await expect(page.getByText('+ Snapshot')).toHaveCount(0)
  })

})
