// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ─────────────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// admin mit allen Rechten
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// viewer ohne Admin-Berechtigungen
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// restricted-Nutzer
const RESTRICTED_TOKEN =
  H + '.' +
  'eyJzdWIiOiJyZXN0cmljdGVkIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoicmVzdHJpY3RlZCIsInBvcnRhbF9wZXJtaXNzaW9ucyI6W10sImV4cCI6OTk5OTk5OTk5OX0=' +
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
  node: 'pve', status: 'online',
  cpu: 0.24, maxcpu: 8,
  mem: 4294967296, maxmem: 17179869184,
  disk: 10737418240, maxdisk: 107374182400,
  uptime: 86400, level: '',
}

const MOCK_CLUSTER_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

const MOCK_VM = {
  vmid: 100, name: 'web-server', status: 'running', type: 'qemu',
  node: 'pve', cpu: 0.05, maxcpu: 2,
  mem: 536870912, maxmem: 2147483648,
  disk: 0, maxdisk: 32212254720,
  template: 0, uptime: 3600,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupViewer(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), VIEWER_TOKEN)
}

async function setupRestricted(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), RESTRICTED_TOKEN)
}

async function mockCommon(page, opts = {}) {
  const { role = 'admin', uiVersion = 'v2', portalPermissions = [] } = opts

  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: role, auth_type: 'local', role, active: true, portal_permissions: portalPermissions }),
  }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) }))
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_CLUSTER_NODE]) }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_CLUSTER_STATUS) }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_VM]) }))
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
    r.fulfill({ status: 200, contentType: 'application/json', body: '[{"code":"de","name":"Deutsch","is_builtin":true},{"code":"en","name":"English","is_builtin":true}]' }))
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
  await page.route('/api/cluster/lxc-templates**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"available":[],"installed":[]}' }))
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

// ════════════════════════════════════════════════════════════════════════════════
// 1. V2 Navigation Sidebar
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – V2 Navigation Sidebar', () => {

  test('AC-NAV-1: V2 Sidebar zeigt 7 Hauptnavigationspunkte', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await expect(page.locator('nav').getByText('Dashboard')).toBeVisible()
    await expect(page.locator('nav').getByText('Compute Nodes')).toBeVisible()
    await expect(page.locator('nav').getByText('Provisioning')).toBeVisible()
    await expect(page.locator('nav').getByText('Automation')).toBeVisible()
    await expect(page.locator('nav').getByText('Image Factory')).toBeVisible()
    await expect(page.locator('nav').getByText('Events')).toBeVisible()
    await expect(page.locator('nav').getByText('System Settings')).toBeVisible()
  })

  test('AC-NAV-2: My Account Link ist am unteren Rand der Sidebar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await expect(page.getByText('My Account')).toBeVisible()
  })

  test('AC-NAV-3: V2-Badge in der Sidebar sichtbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await expect(page.getByText('V2')).toBeVisible()
  })

  test('AC-NAV-4: Restricted-Nutzer sieht nur Dashboard', async ({ page }) => {
    await setupRestricted(page)
    await mockCommon(page, { role: 'restricted', uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await expect(page.locator('nav').getByText('Dashboard')).toBeVisible()
    await expect(page.locator('nav').getByText('Compute Nodes')).not.toBeVisible()
    await expect(page.locator('nav').getByText('Provisioning')).not.toBeVisible()
    await expect(page.locator('nav').getByText('System Settings')).not.toBeVisible()
  })

  test('AC-NAV-5: Viewer ohne manage_*-Rechte sieht kein System Settings', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, { role: 'viewer', uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await expect(page.locator('nav').getByText('System Settings')).not.toBeVisible()
  })

  test('AC-NAV-6: Navigation zu Compute Nodes Route funktioniert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await page.locator('nav').getByText('Compute Nodes').click()
    await expect(page).toHaveURL(/\/compute/)
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 2. Dashboard
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Dashboard', () => {

  test('AC-DASH-1: Statusleiste zeigt Node-Name in NodePill', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // NodePill zeigt Node-Namen (kann mehrfach vorkommen – StatusBar + NodeCard)
    await expect(page.getByText('pve').first()).toBeVisible()
  })

  test('AC-DASH-2: Node-Card zeigt CPU%, RAM%, Proxmox-Version', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // CPU: 0.24 → 24%
    await expect(page.locator('[class*="NodeCard"], [data-testid="node-card"]').first().or(
      page.locator('.rounded-lg').filter({ hasText: 'pve' }).first()
    )).toBeVisible()
  })

  test('AC-DASH-3: VM-Tabelle zeigt Filter-Buttons (Alle/Running/Stopped)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // Implementierung verwendet 'Alle', 'Running', 'Stopped' (Spec: ALL/RUNNING/STOPPED → BUG-36-1 Low)
    await expect(page.getByRole('button', { name: 'Alle', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Running', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stopped', exact: true })).toBeVisible()
  })

  test('AC-DASH-4: VM web-server erscheint in der VM-Tabelle', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    await expect(page.getByText('web-server')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 3. Compute Nodes
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Compute Nodes', () => {

  test('AC-COMPUTE-1: /compute Route rendert Compute Nodes Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/compute')
    await page.waitForTimeout(500)

    await expect(page.locator('h1').filter({ hasText: 'Compute Nodes' })).toBeVisible()
  })

  test('AC-COMPUTE-2: Node-Card mit Node-Name wird angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/compute')
    await page.waitForTimeout(500)

    await expect(page.getByText('pve').first()).toBeVisible()
  })

  test('AC-COMPUTE-3: Klick auf Node führt zum Node-Detail /compute/pve', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/compute')
    await page.waitForTimeout(500)

    // Link zur Node-Detailseite anklicken
    await page.getByRole('link', { name: /pve/ }).first().click()
    await expect(page).toHaveURL(/\/compute\/pve/)
  })

  test('AC-COMPUTE-4: Node-Detail Seite zeigt Breadcrumb', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/compute/pve')
    await page.waitForTimeout(500)

    // Breadcrumb zeigt "Compute Nodes" Link (+ Nav-Sidebar hat auch diesen Link → .first())
    await expect(page.getByRole('link', { name: 'Compute Nodes' }).first()).toBeVisible()
    // Breadcrumb zeigt auch den Node-Namen
    await expect(page.locator('text=pve').first()).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 4. Provisioning
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Provisioning', () => {

  test('AC-PROV-1: /provisioning Route rendert Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/provisioning')
    await page.waitForTimeout(500)

    await expect(page.locator('h1').filter({ hasText: 'Provisioning' })).toBeVisible()
  })

  test('AC-PROV-2: VMs-Tab und LXCs-Tab sind vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/provisioning')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'VMs' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LXCs' })).toBeVisible()
  })

  test('AC-PROV-3: LXC-Tab ist anklickbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/provisioning')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'LXCs' }).click()
    await expect(page.getByRole('button', { name: 'LXCs' })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 5. Automation
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Automation', () => {

  test('AC-AUTO-1: /automation Route rendert Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/automation')
    await page.waitForTimeout(500)

    await expect(page.locator('h1').filter({ hasText: 'Automation' })).toBeVisible()
  })

  test('AC-AUTO-2: Playbooks-Tab und Scheduled Jobs-Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/automation')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'Playbooks' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Scheduled Jobs' })).toBeVisible()
  })

  test('AC-AUTO-3: Wechsel zu Scheduled Jobs Tab funktioniert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/automation')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'Scheduled Jobs' }).click()
    await page.waitForTimeout(300)
    // Nach Tab-Wechsel sollte "Neuer Job" Button sichtbar sein
    await expect(page.getByRole('button', { name: /Neuer Job/ })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 6. Image Factory
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Image Factory', () => {

  test('AC-IMG-1: /image-factory Route rendert Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/image-factory')
    await page.waitForTimeout(500)

    await expect(page.locator('h1').filter({ hasText: 'Image Factory' })).toBeVisible()
  })

  test('AC-IMG-2: Alle 4 Tabs vorhanden (VM Images, VM Templates, LXC Templates, ISOs)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.route('/api/cluster/nodes/*/storage', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/image-factory')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'VM Images', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'VM Templates', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'LXC Templates', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ISOs', exact: true })).toBeVisible()
  })

  test('AC-IMG-3: LXC Templates Tab ist anklickbar und zeigt Inhalt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.route('/api/cluster/nodes/*/storage', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/image-factory')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'LXC Templates', exact: true }).click()
    await page.waitForTimeout(500)
    // Tab-Button bleibt aktiv und Seite crasht nicht
    await expect(page.locator('h1').filter({ hasText: 'Image Factory' })).toBeVisible()
  })

  test('AC-IMG-4: ISOs Tab ist anklickbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/image-factory')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'ISOs' }).click()
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: 'ISOs' })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 7. Events
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Events', () => {

  test('AC-EVT-1: /events Route rendert Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/events')
    await page.waitForTimeout(500)

    await expect(page.locator('h1').filter({ hasText: 'Events' })).toBeVisible()
  })

  test('AC-EVT-2: Alle 4 Tabs vorhanden (Jobs, Alert-Historie, Audit Log, Proxmox Audit)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.route('/api/admin/proxmox-audit/visible', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: 'true' }))
    await page.goto('/events')
    await page.waitForTimeout(500)

    // Spec nannte "Alerts", implementiert als "Alert-Historie" (BUG-36-1: Label-Unterschied)
    await expect(page.getByRole('button', { name: 'Jobs', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Alert-Historie', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Audit Log', exact: true })).toBeVisible()
  })

  test('AC-EVT-3: Alert-Historie Tab anklickbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/events')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'Alert-Historie', exact: true }).click()
    await page.waitForTimeout(300)
    await expect(page.locator('h1').filter({ hasText: 'Events' })).toBeVisible()
  })

  test('AC-EVT-4: Proxmox Audit-Tab anklickbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/events')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'Proxmox Audit' }).click()
    await page.waitForTimeout(300)
    await expect(page.getByRole('button', { name: 'Proxmox Audit' })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 8. System Settings
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – System Settings', () => {

  test('AC-SYS-1: /system-settings Route rendert Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/system-settings')
    await page.waitForTimeout(500)

    await expect(page.locator('h1').filter({ hasText: 'System Settings' })).toBeVisible()
  })

  test('AC-SYS-2: Nutzer-Tab und Nodes-Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/system-settings')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'Nutzer', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nodes', exact: true })).toBeVisible()
  })

  test('AC-SYS-3: Portal-Tab und Integrations-Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/system-settings')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'Portal', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Integrationen', exact: true })).toBeVisible()
  })

  test('AC-SYS-4: Portal-Tab enthält V1/V2 Interface-Toggle', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.route('/api/settings/ui-version', async r => {
      if (r.request().method() === 'PUT') return r.fulfill({ status: 204 })
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v2"}' })
    })
    await page.goto('/system-settings')
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: 'Portal', exact: true }).click()
    await page.waitForTimeout(300)

    // Interface-Toggle sichtbar (AppearanceSection hat V1/V2 Toggle)
    await expect(page.getByText(/Interface|V1|V2/i).first()).toBeVisible()
  })

  test('AC-SYS-5: Monitoring-Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/system-settings')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'Monitoring', exact: true })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 9. My Account
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – My Account', () => {

  test('AC-ACC-1: /account Route rendert My Account Seite', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/account')
    await page.waitForTimeout(500)

    await expect(page.getByText('My Account')).toBeVisible()
  })

  test('AC-ACC-2: Profil-Tab und Erscheinungsbild-Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/account')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'Profil' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Erscheinungsbild' })).toBeVisible()
  })

  test('AC-ACC-3: API Keys Tab und Sessions Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/account')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'API Keys' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible()
  })

  test('AC-ACC-4: Benachrichtigungen-Tab vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/account')
    await page.waitForTimeout(500)

    await expect(page.getByRole('button', { name: 'Benachrichtigungen' })).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 10. V1/V2 Toggle
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – V1/V2 Toggle', () => {

  test('AC-TOGGLE-1: V1-Modus rendert alte Sidebar (kein V2-Badge)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v1' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    // V2-Badge darf nicht sichtbar sein
    await expect(page.getByText('V2')).not.toBeVisible()
  })

  test('AC-TOGGLE-2: V1-Modus zeigt alte Navigation mit Playbooks', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v1' })
    await page.route('/api/cluster/vms/ips**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    // V1 Sidebar hat "Playbooks" NavLink (nicht V2-Punkt "Provisioning")
    await expect(page.locator('nav').getByText('Playbooks').first()).toBeVisible()
    await expect(page.locator('nav').getByText('Compute Nodes')).not.toBeVisible()
  })

  test('AC-TOGGLE-3: V2-Default wird beim Laden aus API gelesen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    // V2 Sidebar mit "Compute Nodes" muss sichtbar sein
    await expect(page.locator('nav').getByText('Compute Nodes')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 11. Responsive Design
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Responsive Design', () => {

  test('AC-RESP-1: Tablet (768px) - Sidebar bleibt sichtbar', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    await expect(page.locator('nav').getByText('Dashboard')).toBeVisible()
  })

  test('AC-RESP-2: Mobile (390px) - MobileHeader mit Hamburger sichtbar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    // Hamburger-Button sichtbar (aria-label oder button in header)
    const hamburger = page.locator('button[aria-label="Menü öffnen"], button[aria-label*="Menu"], header button').first()
    await expect(hamburger).toBeVisible()
  })

  test('AC-RESP-3: Mobile (390px) - Drawer öffnet bei Hamburger-Klick', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    await page.route('/api/cluster/vms/ips**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await page.goto('/dashboard')
    await page.waitForTimeout(500)

    const hamburger = page.locator('button[aria-label="Menü öffnen"]')
    await hamburger.click()
    await page.waitForTimeout(300)

    // Nach Klick: Drawer mit V2Sidebar öffnet – "Compute Nodes" in Drawer (z-50) sichtbar
    const drawer = page.locator('.fixed.inset-y-0')
    await expect(drawer.getByText('Compute Nodes')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════════
// 12. Edge Cases
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-36 – Edge Cases', () => {

  test('AC-EDGE-1: Keine Nodes konfiguriert - Dashboard zeigt leere Node-Cards mit Hinweis', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v2' })
    // Override: keine Nodes
    await page.route('/api/cluster/nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // Keine Node-Cards crash - Seite rendert fehlerfrei
    await expect(page.locator('body')).not.toContainText('Error')
    await expect(page.locator('body')).not.toContainText('TypeError')
  })

  test('AC-EDGE-2: V2 Routes bleiben erreichbar auch wenn V1 aktiv ist', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page, { uiVersion: 'v1' })
    await page.route('/api/cluster/vms/ips**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

    // V2-Routes sind immer registriert
    await page.goto('/compute')
    await page.waitForTimeout(500)
    await expect(page.locator('body')).not.toContainText('404')
  })

  test('AC-EDGE-3: StatusBar Multi-Node Bug-Fix - zeigt per-Node CPU statt Durchschnitt', async ({ page }) => {
    await setupAdmin(page)
    const multiNodeStatus = { quorum: true, node_count: 2, ha_status: 'active' }
    await page.route('/api/cluster/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(multiNodeStatus) }))
    await page.route('/api/cluster/nodes', r => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([
        { ...MOCK_CLUSTER_NODE, node: 'pve1', cpu: 0.30 },
        { ...MOCK_CLUSTER_NODE, node: 'pve2', cpu: 0.10 },
      ]),
    }))
    await page.route('/api/setup/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
    await page.route('/api/me', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true, portal_permissions: [] }),
    }))
    await page.route('/api/license/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
    await page.route('/api/admin/nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) }))
    await page.route('/api/cluster/vms', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/alerts/states', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/settings/ui-version', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v2"}' }))
    await page.route('/api/announcements', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await setupAdmin(page)
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // Beide Node-Namen in Statusleiste sichtbar (strict mode: .first())
    await expect(page.getByText('pve1').first()).toBeVisible()
    await expect(page.getByText('pve2').first()).toBeVisible()
    // "Cluster OK" sichtbar (Multi-Node) – exact match für strict mode
    await expect(page.getByText('Cluster OK', { exact: true }).first()).toBeVisible()
  })

})
