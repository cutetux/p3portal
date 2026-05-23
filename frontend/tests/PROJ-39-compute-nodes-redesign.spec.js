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

const NODE_2 = {
  node: 'pve2', status: 'online', portal_node_name: 'Büro',
  cpu: 0.1, maxcpu: 4, mem: 2147483648, maxmem: 8589934592,
  disk: 5368709120, maxdisk: 53687091200, uptime: 43200,
}

const NODE_3 = {
  node: 'pve3', status: 'offline',
  cpu: 0, maxcpu: 4, mem: 0, maxmem: 8589934592,
  disk: 0, maxdisk: 53687091200, uptime: 0,
}

const VM_ON_NODE1 = {
  vmid: 101, name: 'web-server', type: 'qemu', status: 'running',
  node: 'pve1', portal_node_name: 'Heimserver',
  cpu: 0.05, mem: 2147483648, maxmem: 4294967296, uptime: 3600, template: 0,
}

const VM_ON_NODE2 = {
  vmid: 201, name: 'db-server', type: 'qemu', status: 'stopped',
  node: 'pve2', portal_node_name: 'Büro',
  cpu: 0, mem: 0, maxmem: 4294967296, uptime: 0, template: 0,
}

const NODE_DETAIL_PVE1 = {
  node: 'pve1', status: 'online', cpu: 0.3, maxcpu: 8,
  mem: 8589934592, maxmem: 34359738368,
  disk: 10737418240, maxdisk: 107374182400,
  uptime: 86400, pveversion: '8.2.0',
  storage_pools: [
    { storage: 'local', type: 'dir', used: 5368709120, total: 107374182400 },
  ],
  network_interfaces: [
    { iface: 'vmbr0', type: 'bridge', address: '192.168.1.10', active: true },
  ],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupViewer(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), VIEWER_TOKEN)
}

async function mockCommon(page, opts = {}) {
  const { role = 'admin', nodes = [NODE_1], vms = [VM_ON_NODE1] } = opts

  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ setup_required: false, has_admin: true, has_node: true }) }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: role, auth_type: 'local', role, active: true, portal_permissions: [] }),
  }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: 'basis', valid: false, reason: 'missing', limits: { users: { current: 1, max: 6 }, presets: { current: 0, max: 5 } } }) }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'pve1', proxmox_node: 'pve1', is_default: true }]) }))
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vms) }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: nodes.length, ha_status: 'none', unreachable_nodes: [] }) }))
  await page.route('/api/alerts/states', r =>
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
  await page.route('/api/scheduled-jobs', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/rules**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/history**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/history/summary**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"total":0,"by_severity":{}}' }))
  await page.route('/api/profile**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
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
  await page.route('/api/license/details', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: 'basis', valid: false, expiry: null, contact_name: null, contact_email: null }) }))
  await page.route('/api/admin/proxmox-login', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"enabled":false}' }))
  await page.route('/api/admin/monitoring/smtp', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/alerts/presets**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/nodes/*/storage', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/profile/sessions', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/profile/notifications', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"email_enabled":false,"email_address":null,"webhook_url":null,"min_severity":"high"}' }))
  await page.route('/api/i18n/default', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"language":"de"}' }))
  await page.route('/api/external-jobs/api-keys**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/rbac/presets**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/settings**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/cluster/nodes/*/detail', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODE_DETAIL_PVE1) }))
  await page.route('/api/admin/scheduled-jobs/settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"history_limit":20,"has_system_ssh_key":false}' }))
  await page.route('/api/permissions**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"username":"admin","roles":[],"groups":[],"capabilities":{}}' }))
  await page.route('/api/cluster/lxc-templates**', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: '{"available":[],"installed":[],"failed_nodes":[]}' }))
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Seiten-Header + grundlegende Darstellung
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-39 – Compute Nodes Seite: Header & Node-Karten', () => {

  test('AC-1: Compute Nodes Seite lädt und zeigt Node-Karten an', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [VM_ON_NODE1, VM_ON_NODE2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Compute Nodes' })).toBeVisible()
    // Use tracking-tight class which uniquely identifies NodeCard node names
    await expect(page.locator('.tracking-tight').filter({ hasText: 'pve1' })).toBeVisible()
    await expect(page.locator('.tracking-tight').filter({ hasText: 'pve2' })).toBeVisible()
  })

  test('AC-2: Node-Karte zeigt 3-Spalten Ressourcen-Layout (CPU, RAM, Disk)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('CPU').first()).toBeVisible()
    await expect(page.getByText('RAM').first()).toBeVisible()
    await expect(page.getByText('Disk').first()).toBeVisible()
  })

  test('AC-3: Node-Zähler im Abschnitts-Header zeigt korrekte Anzahl', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Nodes (2)')).toBeVisible()
  })

  test('AC-4: Offline-Node zeigt Offline-Badge und keine Ressourcen-Balken', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_3], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Offline')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 2. Node-Selektion
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-39 – Node-Selektion: Klick + Tab-Bereich', () => {

  test('AC-5: Klick auf Node-Karte zeigt Tab-Bereich mit "VM & LXC" und "Node Details"', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [VM_ON_NODE1, VM_ON_NODE2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Click via tracking-tight span (unique NodeCard node name) to trigger parent div onClick
    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    await expect(page.getByRole('button', { name: /VM & LXC/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Node Details/ })).toBeVisible()
  })

  test('AC-6: Tab "VM & LXC" filtert VMs nach ausgewähltem Node', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [VM_ON_NODE1, VM_ON_NODE2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    // web-server (pve1) sichtbar, db-server (pve2) nicht
    await expect(page.getByRole('cell', { name: 'web-server', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'db-server', exact: true })).not.toBeVisible()
  })

  test('AC-7: Tab "Node Details" zeigt NodeDetailSection mit Storage Pools und Netzwerk', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1], vms: [VM_ON_NODE1] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: /Node Details/ }).click()
    await page.waitForTimeout(500)

    await expect(page.getByText('Storage Pools')).toBeVisible()
    await expect(page.getByText('Netzwerk-Interfaces')).toBeVisible()
  })

  test('AC-8: Tab-Wechsel zurück zu "VM & LXC" zeigt wieder VMs', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1], vms: [VM_ON_NODE1] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    // zu Node Details wechseln
    await page.getByRole('button', { name: /Node Details/ }).click()
    await page.waitForTimeout(300)

    // zurück zu VM & LXC
    await page.getByRole('button', { name: /VM & LXC/ }).click()
    await page.waitForTimeout(300)

    await expect(page.getByRole('cell', { name: 'web-server', exact: true })).toBeVisible()
  })

  test('AC-9: Erneuter Klick auf dieselbe Node hebt Auswahl auf', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [VM_ON_NODE1, VM_ON_NODE2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    // Tab-Bereich ist sichtbar
    await expect(page.getByRole('button', { name: /VM & LXC/ })).toBeVisible()

    // erneuter Klick → Auswahl aufgehoben
    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    await expect(page.getByRole('button', { name: /VM & LXC/ })).not.toBeVisible()
    await expect(page.getByRole('button', { name: /Node Details/ })).not.toBeVisible()
  })

  test('AC-10: "Auswahl aufheben" Button deselektiert Node', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [VM_ON_NODE1, VM_ON_NODE2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await page.locator('.tracking-tight').filter({ hasText: 'pve1' }).click()
    await page.waitForTimeout(300)

    // Tab-Bereich erscheint → Auswahl aufheben
    await expect(page.getByRole('button', { name: /VM & LXC/ })).toBeVisible()
    await page.getByRole('button', { name: /Auswahl aufheben/ }).click()
    await page.waitForTimeout(300)

    // Tab-Bereich verschwunden, alle VMs wieder sichtbar
    await expect(page.getByRole('button', { name: /VM & LXC/ })).not.toBeVisible()
    await expect(page.getByRole('cell', { name: 'web-server', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'db-server', exact: true })).toBeVisible()
  })

  test('AC-11: Ohne Selektion werden alle VMs angezeigt (Standardverhalten)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1, NODE_2], vms: [VM_ON_NODE1, VM_ON_NODE2] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Kein Node angeklickt → beide VMs sichtbar
    await expect(page.getByRole('cell', { name: 'web-server', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'db-server', exact: true })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 3. "+Node hinzufügen" Karte
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-39 – +Node hinzufügen Karte', () => {

  test('AC-12: Admin sieht "+Node hinzufügen" Karte', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { role: 'admin', nodes: [NODE_1], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('button', { name: 'Node hinzufügen' })).toBeVisible()
  })

  test('AC-13: Viewer sieht KEINE "+Node hinzufügen" Karte', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer', nodes: [NODE_1], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('button', { name: 'Node hinzufügen' })).not.toBeVisible()
  })

  test('AC-14: Klick auf "+Node hinzufügen" navigiert zu /system-settings', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { role: 'admin', nodes: [NODE_1], vms: [] })

    await page.route('/api/admin/rbac**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Node hinzufügen' }).click()
    await page.waitForTimeout(300)

    await expect(page).toHaveURL(/system-settings/)
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 4. Adaptives Grid
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-39 – Adaptives Grid', () => {

  test('AC-15: 1 Node (Admin) → "+Node" → 2 Items → grid-cols-2', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { role: 'admin', nodes: [NODE_1], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Admin + 1 Node = 2 Items → grid-cols-2
    // Use first() to avoid matching inner 3-col CompactBar grid
    const grid = page.locator('.grid.gap-4').first()
    await expect(grid).toHaveClass(/grid-cols-2/)
  })

  test('AC-16: 3 Nodes (Viewer, kein +Node) → grid-cols-3', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer', nodes: [NODE_1, NODE_2, NODE_3], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Viewer + 3 Nodes = 3 Items → grid-cols-3
    const grid = page.locator('.grid.gap-4').first()
    await expect(grid).toHaveClass(/grid-cols-3/)
  })

  test('AC-17: 1 Node (Viewer, kein +Node) → grid-cols-1', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer', nodes: [NODE_1], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    // Viewer + 1 Node = 1 Item → grid-cols-1
    const grid = page.locator('.grid.gap-4').first()
    await expect(grid).toHaveClass(/grid-cols-1/)
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 5. Aktualisieren-Button
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-39 – Aktualisieren-Button', () => {

  test('AC-18: "Aktualisieren" Button ist sichtbar und anklickbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { nodes: [NODE_1], vms: [] })

    await page.goto('/compute')
    await page.waitForLoadState('networkidle')

    const refreshBtn = page.getByRole('button', { name: /Aktualisieren/ })
    await expect(refreshBtn).toBeVisible()
    await expect(refreshBtn).toBeEnabled()
  })

})
