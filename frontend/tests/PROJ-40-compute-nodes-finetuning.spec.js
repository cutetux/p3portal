// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ─────────────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ─────────────────────────────────────────────────────────────────

const NODE_1 = {
  node: 'pve1', status: 'online', portal_node_name: 'Heimserver',
  cpu: 0.3, maxcpu: 8, mem: 8589934592, maxmem: 34359738368,
  disk: 10737418240, maxdisk: 107374182400, uptime: 86400,
}

const VMS = [
  { vmid: 101, name: 'web-server', type: 'qemu', status: 'running', node: 'pve1', portal_node_name: 'Heimserver', cpu: 0.05, mem: 2147483648, maxmem: 4294967296, uptime: 3600, template: 0 },
  { vmid: 102, name: 'db-lxc', type: 'lxc', status: 'running', node: 'pve1', portal_node_name: 'Heimserver', cpu: 0.02, mem: 1073741824, maxmem: 2147483648, uptime: 7200, template: 0 },
  { vmid: 9000, name: 'ubuntu-tmpl', type: 'qemu', status: 'stopped', node: 'pve1', portal_node_name: 'Heimserver', cpu: 0, mem: 0, maxmem: 2147483648, uptime: 0, template: 1 },
]

const TASKS = [
  { upid: 'UPID:pve1:001', type: 'qmstart',  user: 'root@pam', status: 'OK',      starttime: 1715000000, endtime: 1715000005, duration: 5 },
  { upid: 'UPID:pve1:002', type: 'vzdump',   user: 'admin',    status: 'ERROR',   starttime: 1715001000, endtime: 1715001120, duration: 120 },
  { upid: 'UPID:pve1:003', type: 'vzevent',  user: 'user1',    status: 'RUNNING', starttime: 1715002000, endtime: null, duration: null },
]

const BACKUPS = [
  { upid: 'UPID:pve1:010', vmid: 101, status: 'OK',    starttime: 1715010000, duration: 300 },
  { upid: 'UPID:pve1:011', vmid: 102, status: 'ERROR', starttime: 1715020000, duration: 45 },
]

const ALERT_RULES = [
  { id: 1, name: 'CPU-Alert', metric: 'cpu', threshold: 90, severity: 'critical', node_id: 1 },
  { id: 2, name: 'RAM-Alert', metric: 'memory', threshold: 80, severity: 'warning', node_id: 1 },
  { id: 3, name: 'Global Rule', metric: 'disk', threshold: 95, severity: 'warning', node_id: null },
]

const ALERT_STATES = [
  { rule_id: 1, vmid: 101, node_id: 1, state: 'critical', severity: 'critical', rule_name: 'CPU-Alert' },
]

const SCHEDULED_JOBS = [
  {
    id: 1, name: 'Nightly Shutdown pve1', job_type: 'power_action',
    cron_expression: '0 2 * * *', is_active: true, last_run_at: null, next_run_at: '2026-05-09T02:00:00',
    config: { node: 'pve1', action: 'shutdown', vmid: 101 },
  },
  {
    id: 2, name: 'Deploy App on pve1', job_type: 'playbook',
    cron_expression: '0 3 * * *', is_active: false, last_run_at: null, next_run_at: null,
    config: { params: { proxmox_node: 'pve1' } },
  },
]

const NODE_DETAIL = {
  node: 'pve1', status: 'online', cpu: 0.3, maxcpu: 8,
  mem: 8589934592, maxmem: 34359738368, disk: 10737418240, maxdisk: 107374182400,
  uptime: 86400, pveversion: '8.2.0',
  storage_pools: [{ storage: 'local', type: 'dir', used: 5368709120, total: 107374182400 }],
  network_interfaces: [{ iface: 'vmbr0', type: 'bridge', address: '192.168.1.10', active: true }],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupViewer(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), VIEWER_TOKEN)
}

async function mockBase(page, opts = {}) {
  const {
    role = 'admin',
    nodes = [NODE_1],
    vms = VMS,
    isPlus = false,
    tasks = TASKS,
    backups = BACKUPS,
    alertRules = [],
    alertStates = [],
    scheduledJobs = [],
  } = opts

  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ setup_required: false, has_admin: true, has_node: true }) }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: role, auth_type: 'local', role, active: true, portal_permissions: [] }),
  }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: isPlus ? 'plus' : 'basis', valid: isPlus, reason: isPlus ? null : 'missing', limits: { users: { current: 1, max: 6 }, presets: { current: 0, max: 5 } } }) }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'Heimserver', proxmox_node: 'pve1', is_default: true }]) }))
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vms) }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: nodes.length, ha_status: 'none', unreachable_nodes: [] }) }))
  await page.route('/api/cluster/nodes/*/tasks**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tasks) }))
  await page.route('/api/cluster/nodes/*/backups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(backups) }))
  await page.route('/api/alerts/rules**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(alertRules) }))
  await page.route('/api/alerts/states', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(alertStates) }))
  await page.route('/api/alerts/presets**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/history/summary**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"total":0,"by_severity":{}}' }))
  await page.route('/api/scheduled-jobs', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(scheduledJobs) }))
  await page.route('/api/cluster/nodes/*/detail', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODE_DETAIL) }))
  await page.route('/api/cluster/nodes/*/storage', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/settings/ui-version', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v2"}' }))
  await page.route('/api/announcements', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/jobs', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/packer/templates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/audit-logs**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/proxmox-audit**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/scheduled-jobs/settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"history_limit":20,"has_system_ssh_key":false}' }))
  await page.route('/api/profile**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/profile/sessions', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/profile/notifications', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"email_enabled":false,"email_address":null,"webhook_url":null,"min_severity":"high"}' }))
  await page.route('/api/user-api-keys**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/permissions', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: role, roles: [], groups: [], capabilities: {} }) }))
  await page.route('/api/rbac/me/permissions**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"roles":[],"assignments":[]}' }))
  await page.route('/api/vms/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"ip":null}' }))
  await page.route('/api/cluster/vms/ips**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/themes**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/i18n/language**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[{"code":"de","name":"Deutsch","is_builtin":true}]' }))
  await page.route('/api/i18n/default', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"language":"de"}' }))
  await page.route('/api/license/details', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: isPlus ? 'plus' : 'basis', valid: isPlus, expiry: null }) }))
  await page.route('/api/admin/proxmox-login', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }))
  await page.route('/api/admin/monitoring/smtp', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/external-jobs/api-keys**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/rbac/presets**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/settings**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/permissions**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"username":"admin","roles":[],"groups":[],"capabilities":{}}' }))
  await page.route('/api/cluster/lxc-templates**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"available":[],"installed":[],"failed_nodes":[]}' }))
}

async function gotoComputeAndSelectNode(page) {
  await page.goto('/compute')
  await page.waitForLoadState('networkidle')
  await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
  await page.waitForLoadState('networkidle')
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Tab-System Grundstruktur
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab-System Grundstruktur', () => {

  test('Zeigt 7 Tabs nach Node-Klick', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    await expect(page.getByRole('button', { name: /VM & LXC/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Node Details/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Templates/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ereignisse/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Backups/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Alerting/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Scheduled Jobs/ })).toBeVisible()
  })

  test('Alerting und Scheduled Jobs haben Plus-Badge', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    const alertingTab = page.getByRole('button', { name: /Alerting/ })
    await expect(alertingTab.getByText('Plus')).toBeVisible()

    const sjTab = page.getByRole('button', { name: /Scheduled Jobs/ })
    await expect(sjTab.getByText('Plus')).toBeVisible()
  })

  test('AC-27: Tab-Wechsel behält Node-Selektion bei', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    // Start on VM & LXC, switch to Templates, check node still selected
    await page.getByRole('button', { name: /Templates/ }).click()
    await page.waitForLoadState('networkidle')

    // Node header still visible (Auswahl aufheben button exists)
    await expect(page.getByRole('button', { name: /Auswahl aufheben/ })).toBeVisible()
    // Templates tab is now active
    await expect(page.getByRole('button', { name: /Templates/ })).toBeVisible()
  })

  test('AC-28: Node-Wechsel setzt aktiven Tab auf VM & LXC zurück', async ({ page }) => {
    await setupAdmin(page)
    const node2 = { ...NODE_1, node: 'pve2', portal_node_name: 'Büro' }
    await mockBase(page, { nodes: [NODE_1, node2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Click pve1, switch to Ereignisse
    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: /Ereignisse/ }).click()

    // Now click pve2 – tab should reset to VM & LXC
    await page.locator('.tracking-tight').filter({ hasText: 'pve2' }).click()
    await page.waitForLoadState('networkidle')

    // VM & LXC tab should now be active (orange border)
    const vmTab = page.getByRole('button', { name: /VM & LXC/ })
    await expect(vmTab).toHaveClass(/border-orange-500/)
  })

  test('Kein Tab-Bereich wenn keine Node ausgewählt', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Tab buttons should not exist before node selection
    await expect(page.getByRole('button', { name: /VM & LXC/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Ereignisse/ })).toHaveCount(0)
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 2. Tab VM & LXC
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab VM & LXC', () => {

  test('AC-1: Zeigt Filter-Toggle mit Alle / VMs / LXC', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    await expect(page.getByRole('button', { name: 'Alle', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'VMs', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LXC', exact: true })).toBeVisible()
  })

  test('AC-2: Standard-Auswahl ist Alle – zeigt VM und LXC', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    await expect(page.getByText('web-server')).toBeVisible()
    await expect(page.getByText('db-lxc')).toBeVisible()
    // Template excluded from VM list
    await expect(page.getByText('ubuntu-tmpl')).toHaveCount(0)
  })

  test('AC-3: Filter VMs zeigt nur qemu', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: 'VMs' }).click()

    await expect(page.getByText('web-server')).toBeVisible()
    await expect(page.getByText('db-lxc')).toHaveCount(0)
  })

  test('AC-4: Filter LXC zeigt nur lxc', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: 'LXC', exact: true }).click()

    await expect(page.getByText('db-lxc')).toBeVisible()
    await expect(page.getByText('web-server')).toHaveCount(0)
  })

  test('AC-5: Tab-Zähler zeigt Gesamt (ohne Templates)', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    // VMS has 2 non-templates (101, 102)
    const vmTab = page.getByRole('button', { name: /VM & LXC/ })
    await expect(vmTab.locator('span').filter({ hasText: '(2)' })).toBeVisible()
  })

  test('Edge: LXC-Filter zeigt Leer-Zustand wenn nur VMs vorhanden', async ({ page }) => {
    await setupAdmin(page)
    const onlyVms = [VMS[0]] // only qemu
    await mockBase(page, { vms: onlyVms })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: 'LXC', exact: true }).click()
    await expect(page.getByText('Keine LXC Container auf dieser Node')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 3. Tab Templates
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab Templates', () => {

  test('AC-7+8: Zeigt Templates mit Name, Typ, VMID, Storage', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Templates/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('ubuntu-tmpl')).toBeVisible()
    await expect(page.getByText('9000')).toBeVisible()
    // VM badge (exact to avoid matching "VM & LXC" tab)
    await expect(page.getByText('VM', { exact: true })).toBeVisible()
  })

  test('AC-9: Leer-Zustand wenn keine Templates', async ({ page }) => {
    await setupAdmin(page)
    const noTemplates = VMS.filter(v => !v.template)
    await mockBase(page, { vms: noTemplates })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Templates/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Keine Templates auf dieser Node')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 4. Tab Letzte Ereignisse
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab Letzte Ereignisse', () => {

  test('AC-10+11: Zeigt Task-Daten mit Typ, Benutzer, Status, Dauer', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { tasks: TASKS })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Ereignisse/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('qmstart')).toBeVisible()
    await expect(page.getByText('root@pam')).toBeVisible()
    await expect(page.getByText('vzdump')).toBeVisible()
    // 'admin' appears in sidebar username too → use table cell
    await expect(page.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()
    await expect(page.getByText('5s')).toBeVisible()
    await expect(page.getByText('2m 0s')).toBeVisible()
  })

  test('AC-12: Status-Badges – OK grün, RUNNING orange, ERROR rot', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { tasks: TASKS })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Ereignisse/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.locator('.bg-green-500').first()).toBeVisible()
    await expect(page.locator('.bg-orange-400').first()).toBeVisible()
    await expect(page.locator('.bg-red-500').first()).toBeVisible()
  })

  test('AC-14: Fehlermeldung wenn API-Fehler', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)

    // Override tasks route to return 500
    await page.route('/api/cluster/nodes/*/tasks**', r => r.fulfill({ status: 500 }))

    await gotoComputeAndSelectNode(page)
    await page.getByRole('button', { name: /Ereignisse/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Ereignisse konnten nicht geladen werden.')).toBeVisible()
  })

  test('Leer-Zustand bei leerer Task-Liste', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { tasks: [] })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Ereignisse/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Keine Ereignisse gefunden')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 5. Tab Backups
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab Backups', () => {

  test('AC-15+16: Zeigt Backup-Daten mit VMID, Status, Startzeit, Dauer', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { backups: BACKUPS })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Backups/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('101')).toBeVisible()
    await expect(page.getByText('5m 0s')).toBeVisible()
    await expect(page.getByText('45s')).toBeVisible()
  })

  test('AC-17: Kein Backup-starten-Button', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { backups: BACKUPS })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Backups/ }).click()
    await page.waitForLoadState('networkidle')

    // Verify no "Backup starten" or "Start" action button
    await expect(page.getByRole('button', { name: /Backup starten/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Start/i })).toHaveCount(0)
  })

  test('AC-18: Leer-Zustand bei keinen Backups', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { backups: [] })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Backups/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Keine Backups für diese Node gefunden')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 6. Tab Alerting (Plus-Gate)
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab Alerting', () => {

  test('AC-19: Basis-Nutzer sehen Plus-Gate', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { isPlus: false })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Alerting/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P3 Plus erforderlich')).toBeVisible()
    await expect(page.getByText('Alerting und Node-Monitoring sind exklusive Plus-Funktionen.')).toBeVisible()
  })

  test('AC-20+21: Plus-Nutzer sehen Alert-Rules und aktive Alerts', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { isPlus: true, alertRules: ALERT_RULES, alertStates: ALERT_STATES })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Alerting/ }).click()
    await page.waitForLoadState('networkidle')

    // Active alert section
    await expect(page.getByText(/Aktive Alerts/)).toBeVisible()
    // CPU-Alert appears in both alert row and rules table → use first()
    await expect(page.getByText('CPU-Alert').first()).toBeVisible()

    // Rules table
    await expect(page.getByText('RAM-Alert')).toBeVisible()
  })

  test('AC-22: Plus-Nutzer – Leer-Zustand wenn keine Regeln für Node', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { isPlus: true, alertRules: [], alertStates: [] })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Alerting/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Keine Alert-Regeln für diese Node konfiguriert')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 7. Tab Scheduled Jobs (Plus-Gate)
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Tab Scheduled Jobs', () => {

  test('AC-23: Basis-Nutzer sehen Plus-Gate', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { isPlus: false })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Scheduled Jobs/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('P3 Plus erforderlich')).toBeVisible()
    await expect(page.getByText('Scheduled Jobs sind eine exklusive Plus-Funktion.')).toBeVisible()
  })

  test('AC-24+25: Plus-Nutzer sehen Jobs gefiltert nach Node', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { isPlus: true, scheduledJobs: SCHEDULED_JOBS })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Scheduled Jobs/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Nightly Shutdown pve1')).toBeVisible()
    await expect(page.getByText('Deploy App on pve1')).toBeVisible()
    // Cron expression
    await expect(page.getByText('0 2 * * *')).toBeVisible()
    // Type badges
    await expect(page.getByText('Power')).toBeVisible()
    await expect(page.getByText('Playbook')).toBeVisible()
  })

  test('AC-26: Leer-Zustand wenn keine Jobs für Node', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page, { isPlus: true, scheduledJobs: [] })
    await gotoComputeAndSelectNode(page)

    await page.getByRole('button', { name: /Scheduled Jobs/ }).click()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Keine Scheduled Jobs für diese Node konfiguriert')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 8. Dashboard-Regression (AC-29)
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-40 – Dashboard Regression AC-29', () => {

  test('AC-29: Dashboard-Seite zeigt NodeCard unverändert', async ({ page }) => {
    await setupViewer(page)
    await mockBase(page, { role: 'viewer' })

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // The dashboard node section shows pve1
    await expect(page.getByText('pve1').first()).toBeVisible()
  })

  test('AC-6: VmSection auf Dashboard bleibt unverändert', async ({ page }) => {
    await setupAdmin(page)
    await mockBase(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // VM table should be visible on Dashboard (VmSection)
    await expect(page.getByText('web-server')).toBeVisible()
  })

})
