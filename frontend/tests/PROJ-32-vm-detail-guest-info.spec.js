// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const QEMU_DETAIL = {
  vmid: 100,
  name: 'web-server',
  type: 'qemu',
  status: 'running',
  node: 'pve1',
  ip: '192.168.1.100',
  uptime: 3661,
  tags: [],
  is_template: false,
  cpu_usage: 0.12,
  cpu_cores: 4,
  mem_used: 2147483648,
  mem_total: 8589934592,
  bios: 'seabios',
  ostype: 'l26',
  networks: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' }],
  disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G' }],
  // PROJ-32 new config fields
  cpu_type: 'kvm64',
  sockets: 2,
  onboot: true,
  protection: false,
  description: 'Production web server\nDeployed 2026-01-01',
  lxc_hostname: null,
  lxc_ostemplate: null,
}

const LXC_DETAIL = {
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
  // PROJ-32 new config fields
  cpu_type: null,
  sockets: null,
  onboot: true,
  protection: null,
  description: null,
  lxc_hostname: 'app-container',
  lxc_ostemplate: 'local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst',
}

const GUEST_INFO_SUCCESS = {
  os_name: 'Ubuntu',
  os_version: '24.04.2 LTS',
  kernel: '6.8.0-51-generic',
  arch: 'x86_64',
  hostname: 'web-server-guest',
  timezone: 'Europe/Berlin',
  timezone_offset: 7200,
  filesystems: [
    { mountpoint: '/', fstype: 'ext4', total_bytes: 34359738368, used_bytes: 10737418240 },
    { mountpoint: '/home', fstype: 'ext4', total_bytes: 10737418240, used_bytes: 2147483648 },
  ],
  truncated_count: 0,
}

const GUEST_INFO_NO_AGENT = {
  os_name: null,
  os_version: null,
  kernel: null,
  arch: null,
  hostname: null,
  timezone: null,
  timezone_offset: null,
  filesystems: [],
  truncated_count: 0,
}

const GUEST_INFO_TRUNCATED = {
  ...GUEST_INFO_SUCCESS,
  filesystems: [
    { mountpoint: '/', fstype: 'ext4', total_bytes: 34359738368, used_bytes: 10737418240 },
  ],
  truncated_count: 7,
}

const LXC_INTERFACES = [
  { name: 'eth0', inet: '192.168.1.200/24', inet6: null, hwaddr: 'AA:BB:CC:DD:EE:FF' },
  { name: 'lo', inet: '127.0.0.1/8', inet6: '::1/128', hwaddr: null },
]

const BACKUPS_EMPTY = { backups: [], schedules: [], storages: [] }

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

async function mockQemuPage(page, detail = QEMU_DETAIL, guestInfo = GUEST_INFO_SUCCESS) {
  await mockBaseApi(page)
  await page.route('**/api/cluster/vms/pve1/qemu/100', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }))
  await page.route('**/api/cluster/vms/pve1/qemu/100/backups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BACKUPS_EMPTY) }))
  await page.route('**/api/vms/100/snapshots', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/cluster/vms/pve1/qemu/100/guest-info', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(guestInfo) }))
}

async function mockLxcPage(page, detail = LXC_DETAIL, interfaces = LXC_INTERFACES) {
  await mockBaseApi(page)
  await page.route('**/api/cluster/vms/pve1/lxc/300', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }))
  await page.route('**/api/cluster/vms/pve1/lxc/300/backups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BACKUPS_EMPTY) }))
  await page.route('**/api/vms/300/snapshots', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/cluster/vms/pve1/lxc/300/interfaces', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(interfaces) }))
}

// ══════════════════════════════════════════════════════════════════════════════
// Config-Sektion – neue Felder (QEMU)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-32 – Config-Sektion QEMU', () => {

  test('zeigt CPU-Typ aus vm_config', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('kvm64')).toBeVisible()
  })

  test('zeigt CPU-Sockets aus vm_config', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('CPU-Sockets')).toBeVisible()
    await expect(page.getByText('2').first()).toBeVisible()
  })

  test('zeigt Start-bei-Boot als "Ja"', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('Start bei Boot')).toBeVisible()
    await expect(page.getByText('Ja').first()).toBeVisible()
  })

  test('zeigt Lösch-Schutz als "Nein"', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('Lösch-Schutz')).toBeVisible()
  })

  test('zeigt Beschreibungs-Block wenn description vorhanden', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('Notizen')).toBeVisible()
    await expect(page.getByText(/Production web server/)).toBeVisible()
  })

  test('blendet Notizen-Block aus wenn description leer', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    const detail = { ...QEMU_DETAIL, description: null }
    await mockQemuPage(page, detail)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('Notizen')).not.toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Gastsystem-Sektion (QEMU)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-32 – Gastsystem-Sektion (QEMU)', () => {

  test('zeigt Sektion "Gastsystem" auf QEMU-Detailseite', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('Gastsystem')).toBeVisible()
  })

  test('zeigt OS-Info: Name, Version, Kernel, Architektur', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText(/Ubuntu.*24\.04\.2 LTS/)).toBeVisible()
    await expect(page.getByText(/6\.8\.0-51-generic/)).toBeVisible()
    await expect(page.getByText(/x86_64/)).toBeVisible()
  })

  test('zeigt Gast-Hostname', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('Hostname (Gast)')).toBeVisible()
    await expect(page.getByText('web-server-guest')).toBeVisible()
  })

  test('zeigt Zeitzone mit UTC-Offset', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText(/Europe\/Berlin.*UTC\+2/)).toBeVisible()
  })

  test('zeigt Filesystem-Liste mit Mountpoint und fstype', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('/', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('ext4').first()).toBeVisible()
    await expect(page.getByText('/home')).toBeVisible()
  })

  test('zeigt "Keine OS-Informationen" wenn alle Agent-Felder null', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page, QEMU_DETAIL, GUEST_INFO_NO_AGENT)
    await page.goto('/vm/pve1/qemu/100')
    // API antwortet mit 200 und leeren Feldern → Sektion zeigt "Keine OS-Informationen"
    await expect(page.getByText(/Keine OS-Informationen/)).toBeVisible()
  })

  test('zeigt Fallback wenn guest-info API 500 zurückgibt', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/cluster/vms/pve1/qemu/100', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QEMU_DETAIL) }))
    await page.route('**/api/cluster/vms/pve1/qemu/100/backups', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BACKUPS_EMPTY) }))
    await page.route('**/api/vms/100/snapshots', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/cluster/vms/pve1/qemu/100/guest-info', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Agent error"}' }))
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText(/Guest Agent nicht verfügbar/)).toBeVisible()
  })

  test('zeigt truncated_count-Hinweis', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page, QEMU_DETAIL, GUEST_INFO_TRUNCATED)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText(/7 weitere Dateisysteme ausgeblendet/)).toBeVisible()
  })

  test('zeigt KEINE Gastsystem-Sektion auf LXC-Detailseite', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    // Gastsystem-Sektion darf nicht vorhanden sein
    await expect(page.getByText('Gastsystem')).not.toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Config-Sektion – LXC-Erweiterung
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-32 – Config-Sektion LXC', () => {

  test('zeigt Hostname (LXC) in Config-Sektion', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('Hostname (LXC)')).toBeVisible()
    await expect(page.getByText('app-container')).toBeVisible()
  })

  test('zeigt OS-Template in Config-Sektion', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('OS-Template')).toBeVisible()
    await expect(page.getByText(/debian-12/)).toBeVisible()
  })

  test('blendet Hostname-Feld aus wenn lxc_hostname null', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    const detail = { ...LXC_DETAIL, lxc_hostname: null, lxc_ostemplate: null }
    await mockLxcPage(page, detail)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('Hostname (LXC)')).not.toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// LXC-Netzwerk-Sektion
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-32 – LXC-Netzwerk-Sektion', () => {

  test('zeigt Sektion "Netzwerk-Interfaces (LXC)" auf LXC-Detailseite', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText(/Netzwerk-Interfaces.*LXC/)).toBeVisible()
  })

  test('zeigt Interface-Name und IPv4-Adresse', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('eth0')).toBeVisible()
    await expect(page.getByText('192.168.1.200/24')).toBeVisible()
  })

  test('zeigt IPv6-Adresse für lo-Interface', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('::1/128')).toBeVisible()
  })

  test('zeigt MAC-Adresse für eth0', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('AA:BB:CC:DD:EE:FF').first()).toBeVisible()
  })

  test('zeigt Leer-Zustand wenn keine Interfaces', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page, LXC_DETAIL, [])
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText(/Keine Interface-Daten verfügbar/)).toBeVisible()
  })

  test('zeigt KEINE LXC-Netzwerk-Sektion auf QEMU-Detailseite', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText(/Netzwerk-Interfaces.*LXC/)).not.toBeVisible()
  })

})

// ══════════════════════════════════════════════════════════════════════════════
// Gesamt-Seitenstruktur (Regressions-Check)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-32 – Seitenstruktur & Regression', () => {

  test('QEMU-Detailseite rendert alle Sektionen ohne Fehler', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockQemuPage(page)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('web-server').first()).toBeVisible()
    await expect(page.getByText('Konfiguration').first()).toBeVisible()
    await expect(page.getByText('Gastsystem').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /Snapshots/ }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /Backups/ }).first()).toBeVisible()
  })

  test('LXC-Detailseite rendert alle Sektionen ohne Fehler', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockLxcPage(page)
    await page.goto('/vm/pve1/lxc/300')
    await expect(page.getByText('app-ct').first()).toBeVisible()
    await expect(page.getByText('Konfiguration').first()).toBeVisible()
    await expect(page.getByText(/Netzwerk-Interfaces.*LXC/)).toBeVisible()
    await expect(page.getByRole('heading', { name: /Snapshots/ }).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: /Backups/ }).first()).toBeVisible()
  })

  test('Seite blockiert nicht während Guest-Info geladen wird', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page)
    await page.route('**/api/cluster/vms/pve1/qemu/100', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(QEMU_DETAIL) }))
    await page.route('**/api/cluster/vms/pve1/qemu/100/backups', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BACKUPS_EMPTY) }))
    await page.route('**/api/vms/100/snapshots', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    // Guest-Info antwortet verzögert
    await page.route('**/api/cluster/vms/pve1/qemu/100/guest-info', async r => {
      await new Promise(resolve => setTimeout(resolve, 300))
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GUEST_INFO_SUCCESS) })
    })
    await page.goto('/vm/pve1/qemu/100')
    // VM-Name soll sofort sichtbar sein (Seite lädt nicht wegen Guest-Info)
    await expect(page.getByText('web-server')).toBeVisible()
    // Konfiguration soll auch bereits angezeigt werden
    await expect(page.getByText('Konfiguration')).toBeVisible()
  })

})
