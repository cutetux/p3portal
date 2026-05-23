// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ─────────────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-signature'

const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ─────────────────────────────────────────────────────────────────

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }

const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const MOCK_NODE = {
  id: 1, name: 'Heimserver', url: 'https://pve.example.com:8006',
  proxmox_node: 'pve', verify_ssl: true, poll_interval: 30,
  viewer_token_id: 'viewer@pam!tok', operator_token_id: null,
  admin_token_id: null, packer_token_id: null,
  is_default: true, cluster_nodes: [], created_at: '2026-01-01T00:00:00Z', created_by: 'admin',
}

const MOCK_CLUSTER_NODE = {
  node: 'pve', status: 'online', cpu: 0.24, maxcpu: 8,
  mem: 4294967296, maxmem: 17179869184,
  disk: 10737418240, maxdisk: 107374182400,
  uptime: 86400, level: '',
}

const MOCK_LXC_TEMPLATES = {
  available: [
    { template: 'ubuntu-24.04-standard_24.04-1_amd64.tar.zst', title: 'Ubuntu 24.04', description: 'Ubuntu LTS 24.04', size: 134217728 },
    { template: 'debian-12-standard_12.7-1_amd64.tar.zst', title: 'Debian 12', description: 'Debian 12 Bookworm', size: 99614720 },
  ],
  installed: [
    { volid: 'local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst', portal_node_name: 'pve-main', storage: 'local', size: 134217728 },
  ],
  failed_nodes: [],
}

const MOCK_LXC_TEMPLATES_MULTI_NODE = {
  available: [
    { template: 'ubuntu-24.04-standard_24.04-1_amd64.tar.zst', title: 'Ubuntu 24.04', description: 'Ubuntu LTS', size: 134217728 },
  ],
  installed: [
    { volid: 'local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst', portal_node_name: 'pve-node1', storage: 'local', size: 134217728 },
    { volid: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst', portal_node_name: 'pve-node2', storage: 'local', size: 99614720 },
  ],
  failed_nodes: [],
}

const MOCK_PORTAL_NODES = [
  { name: 'pve-main', proxmox_node: 'pve' },
]

const MOCK_STORAGES = ['local', 'backup-store']

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupOperator(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OPERATOR_TOKEN)
}

async function setupViewer(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), VIEWER_TOKEN)
}

async function mockCommon(page, opts = {}) {
  const { role = 'admin', uiVersion = 'v2' } = opts

  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: role, auth_type: 'local', role, active: true, portal_permissions: [] }),
  }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) }))
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_CLUSTER_NODE]) }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }) }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/states', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/settings/ui-version', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: uiVersion }) }))
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
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: role, roles: [], groups: [], capabilities: {},
    }) }))
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
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      edition: 'basis', valid: false, expiry: null, contact_name: null, contact_email: null,
    }) }))
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
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"email_enabled":false,"email_address":null,"webhook_url":null,"min_severity":"high"}' }))
  await page.route('/api/i18n/default', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"language":"de"}' }))
  await page.route('/api/external-jobs/api-keys**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/rbac/presets**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/settings**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/cluster/nodes/*/detail', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      node: 'pve', status: 'online', cpu: 0.24, maxcpu: 8,
      mem: 4294967296, maxmem: 17179869184,
      storage_pools: [], network_interfaces: [],
      proxmox_version: '8.1.4', uptime: 86400, disk_read: 0, disk_write: 0,
    }) }))
  await page.route('/api/admin/scheduled-jobs/settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"history_limit":20,"has_system_ssh_key":false}' }))
  await page.route('/api/permissions**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"username":"admin","roles":[],"groups":[],"capabilities":{}}' }))
}

async function goToLxcTemplatesTab(page) {
  await page.goto('/image-factory')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'LXC Templates', exact: true }).click()
  await page.waitForTimeout(500)
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Liste – AC-LIST
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-38 – LXC Templates Liste', () => {

  test('AC-LIST-1: Installierte und verfügbare Templates werden angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByText('local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst')).toBeVisible()
    await expect(page.getByText('Ubuntu 24.04').first()).toBeVisible()
    await expect(page.getByText('Debian 12', { exact: true })).toBeVisible()
  })

  test('AC-LIST-2: Node-Filter erscheint wenn Templates auf mehr als einem Node vorhanden sind', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES_MULTI_NODE) }))

    await goToLxcTemplatesTab(page)

    const nodeFilter = page.locator('select').first()
    await expect(nodeFilter).toBeVisible()
    await expect(nodeFilter).toContainText('Alle Nodes')
    await expect(nodeFilter).toContainText('pve-node1')
    await expect(nodeFilter).toContainText('pve-node2')
  })

  test('AC-LIST-3: Node-Filter filtert installierte Templates nach Node', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES_MULTI_NODE) }))

    await goToLxcTemplatesTab(page)

    const nodeFilter = page.locator('select').first()
    await nodeFilter.selectOption('pve-node1')
    await page.waitForTimeout(300)

    await expect(page.getByText('local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst')).toBeVisible()
    await expect(page.getByText('local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst')).not.toBeVisible()
  })

  test('AC-LIST-4: Leerer Zustand bei keinen Templates korrekt angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"available":[],"installed":[],"failed_nodes":[]}' }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByText('Keine Templates heruntergeladen.')).toBeVisible()
    await expect(page.getByText('Keine Templates verfügbar.')).toBeVisible()
  })

  test('AC-LIST-5: Fehler-Banner statt White Screen bei API-Fehler', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Proxmox not reachable"}' }))

    await goToLxcTemplatesTab(page)

    const errorBanner = page.locator('div').filter({ hasText: /fehler|error|proxmox/i }).first()
    await expect(errorBanner).toBeVisible()
    await expect(page.locator('h1').filter({ hasText: 'Image Factory' })).toBeVisible()
  })

  test('AC-LIST-6: FailedNodesBanner erscheint wenn Nodes nicht erreichbar waren', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        available: [], installed: [], failed_nodes: ['offline-node'],
      }) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByText(/offline-node/)).toBeVisible()
  })

  test('AC-LIST-7: Viewer sieht Templates (Lese-Zugriff)', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer' })
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByText('Ubuntu 24.04').first()).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 2. Download – AC-DOWNLOAD
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-38 – LXC Template Download', () => {

  test('AC-DOWNLOAD-1: Admin sieht Download-Button und kann Modal öffnen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)

    const downloadBtns = page.getByRole('button', { name: 'Download' })
    await expect(downloadBtns.first()).toBeVisible()
    await downloadBtns.first().click()
    await page.waitForTimeout(500)

    await expect(page.getByText('LXC Template herunterladen')).toBeVisible()
  })

  test('AC-DOWNLOAD-2: Download-Modal zeigt Node und Storage-Dropdown', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Download' }).first().click()
    await page.waitForTimeout(500)

    await expect(page.getByText('Ziel-Node')).toBeVisible()
    await expect(page.getByText('Ziel-Storage')).toBeVisible()
    const nodeSelect = page.locator('select').first()
    await expect(nodeSelect).toContainText('pve-main')
  })

  test('AC-DOWNLOAD-3: Storage-Dropdown enthält vztmpl-kompatible Storages', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Download' }).first().click()
    await page.waitForTimeout(600)

    const storageSelect = page.locator('select').nth(1)
    await expect(storageSelect).toContainText('local')
    await expect(storageSelect).toContainText('backup-store')
  })

  test('AC-DOWNLOAD-4: Download-Button im Modal startet Download (204)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))
    await page.route('/api/cluster/lxc-templates/download', r =>
      r.fulfill({ status: 204, body: '' }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Download' }).first().click()
    await page.waitForTimeout(600)

    await page.getByRole('button', { name: 'Download starten' }).click()
    await page.waitForTimeout(500)

    await expect(page.getByText(/download.*gestartet/i)).toBeVisible()
  })

  test('AC-DOWNLOAD-5: Viewer sieht keinen Download-Button (kein Operator-Recht)', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer' })
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: 'Download' })).not.toBeVisible()
  })

  test('AC-DOWNLOAD-6: Operator sieht Download-Button', async ({ page }) => {
    await setupOperator(page)
    await mockCommon(page, { role: 'operator' })
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: 'Download' }).first()).toBeVisible()
  })

  test('AC-DOWNLOAD-7: Kein Storage → Hinweistext im Modal', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Download' }).first().click()
    await page.waitForTimeout(600)

    await expect(page.getByText(/kein storage/i)).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 3. Löschen – AC-DELETE
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-38 – LXC Template Löschen', () => {

  test('AC-DELETE-1: Löschen-Button nur für Admin sichtbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: 'Löschen' })).toBeVisible()
  })

  test('AC-DELETE-2: Operator sieht keinen Löschen-Button', async ({ page }) => {
    await setupOperator(page)
    await mockCommon(page, { role: 'operator' })
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: 'Löschen' })).not.toBeVisible()
  })

  test('AC-DELETE-3: Zwei-Schritt-Bestätigung vor dem Löschen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await page.getByRole('button', { name: 'Löschen' }).click()
    await page.waitForTimeout(200)

    await expect(page.getByText('Löschen?')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Ja$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Nein/i })).toBeVisible()
  })

  test('AC-DELETE-4: Abbruch bei Bestätigungsschritt – kein Löschen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    let deleteCalled = false
    await page.route('/api/cluster/lxc-templates**', async r => {
      if (r.request().method() === 'DELETE') {
        deleteCalled = true
        await r.fulfill({ status: 204, body: '' })
      } else {
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) })
      }
    })

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Löschen' }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /Nein/i }).click()
    await page.waitForTimeout(200)

    expect(deleteCalled).toBe(false)
    await expect(page.getByText('Löschen?')).not.toBeVisible()
  })

  test('AC-DELETE-5: Bestätigen löst DELETE-Request aus und zeigt Erfolgsmeldung', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    let deleteCallCount = 0
    await page.route('/api/cluster/lxc-templates**', async r => {
      if (r.request().method() === 'DELETE') {
        deleteCallCount++
        await r.fulfill({ status: 204, body: '' })
      } else {
        await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) })
      }
    })

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Löschen' }).click()
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /^Ja$/ }).click()
    await page.waitForTimeout(500)

    expect(deleteCallCount).toBe(1)
    await expect(page.getByText(/gelöscht/i)).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 4. Upload – AC-UPLOAD
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-38 – LXC Template Upload', () => {

  test('AC-UPLOAD-1: Upload-Button nur für Admin sichtbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: /upload/i })).toBeVisible()
  })

  test('AC-UPLOAD-2: Operator sieht keinen Upload-Button', async ({ page }) => {
    await setupOperator(page)
    await mockCommon(page, { role: 'operator' })
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: /upload/i })).not.toBeVisible()
  })

  test('AC-UPLOAD-3: Upload-Modal öffnet sich mit Node und Storage Dropdown', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: /upload/i }).click()
    await page.waitForTimeout(500)

    await expect(page.getByText('LXC Template hochladen')).toBeVisible()
    await expect(page.getByText('Ziel-Node')).toBeVisible()
    await expect(page.getByText('Ziel-Storage')).toBeVisible()
    await expect(page.getByText('Template-Datei')).toBeVisible()
  })

  test('AC-UPLOAD-4: Upload-Modal zeigt korrektes File-Accept (.tar.gz, .tar.zst)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: /upload/i }).click()
    await page.waitForTimeout(500)

    const fileInput = page.locator('input[type="file"]')
    const accept = await fileInput.getAttribute('accept')
    expect(accept).toContain('.tar.gz')
    expect(accept).toContain('.tar.zst')
  })

  test('AC-UPLOAD-5: Abbrechen schließt Upload-Modal', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: /upload/i }).click()
    await page.waitForTimeout(500)

    await expect(page.getByText('LXC Template hochladen')).toBeVisible()
    await page.getByRole('button', { name: 'Abbrechen' }).click()
    await page.waitForTimeout(300)

    await expect(page.getByText('LXC Template hochladen')).not.toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 5. Security Audit
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-38 – Security Audit', () => {

  test('SEC-1: Viewer kann nicht auf Upload/Delete-Buttons zugreifen', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer' })
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))

    await goToLxcTemplatesTab(page)

    await expect(page.getByRole('button', { name: /upload/i })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Löschen' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: 'Download' })).not.toBeVisible()
  })

  test('SEC-2: Image Factory Seite erfordert Authentifizierung', async ({ page }) => {
    await page.goto('/image-factory')
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(/login/)
  })

  test('SEC-3: Ohne Portal-Nodes-Daten bleibt UI stabil (kein Crash)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Download' }).first().click()
    await page.waitForTimeout(500)

    await expect(page.getByText(/keine nodes konfiguriert/i)).toBeVisible()
    await expect(page.locator('h1').filter({ hasText: 'Image Factory' })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 6. Technische Anforderungen
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-38 – Technische Anforderungen', () => {

  test('TECH-1: API-Endpunkt GET /cluster/lxc-templates wird aufgerufen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    let apiCalled = false
    await page.route('/api/cluster/lxc-templates**', r => {
      apiCalled = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) })
    })

    await goToLxcTemplatesTab(page)

    expect(apiCalled).toBe(true)
  })

  test('TECH-2: Aktualisieren-Button löst Re-Fetch aus', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    let callCount = 0
    await page.route('/api/cluster/lxc-templates**', r => {
      callCount++
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) })
    })

    await goToLxcTemplatesTab(page)
    const before = callCount

    await page.getByText('↻ Aktualisieren').click()
    await page.waitForTimeout(300)

    expect(callCount).toBeGreaterThan(before)
  })

  test('TECH-3: Download-Modal lädt Storages via GET /cluster/lxc-template-storages', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    await page.route('/api/cluster/portal-nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) }))
    let storagesApiCalled = false
    await page.route('/api/cluster/lxc-template-storages**', r => {
      storagesApiCalled = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) })
    })

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: 'Download' }).first().click()
    await page.waitForTimeout(600)

    expect(storagesApiCalled).toBe(true)
  })

  test('TECH-4: Portal-Nodes API wird beim Öffnen von Upload-Modal aufgerufen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/cluster/lxc-templates**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_LXC_TEMPLATES) }))
    let portalNodesApiCalled = false
    await page.route('/api/cluster/portal-nodes', r => {
      portalNodesApiCalled = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PORTAL_NODES) })
    })
    await page.route('/api/cluster/lxc-template-storages**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_STORAGES) }))

    await goToLxcTemplatesTab(page)
    await page.getByRole('button', { name: /upload/i }).click()
    await page.waitForTimeout(500)

    expect(portalNodesApiCalled).toBe(true)
  })

})
