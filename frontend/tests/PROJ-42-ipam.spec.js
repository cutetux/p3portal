// p3portal.org
// PROJ-42 Phase 1 (Core Simple-IPAM) – E2E tests against mocked API (pattern PROJ-103).
// Covers the Core acceptance criteria that are UI-observable:
//  - IPAM area tab in the Netzwerk page, admin-gated (AC: Pool-Verwaltung Admin-only)
//  - Pool list render + empty state (AC: Pool CRUD)
//  - Create pool flow → POST with correct network identity (AC: anlegen)
//  - Delete pool → DELETE (AC: löschen)
//  - Deploy "Freie IP vorschlagen" button fills IP from the pool (Story 2 / AC: Free-IP)
//  - Netz ohne Pool → kein Button (AC: kein Pool → Fallback)
// Backend logic (free-IP edge cases, RBAC 403, duplicate-subnet 409) is covered by
// the 26 pytest cases in backend/features/ipam/ and is not re-tested here.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// role=admin, portal_permissions=[manage_settings]
const ADMIN_TOKEN =
  H + '.eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, portal_permissions: ['manage_settings'], groups: [],
}
const CAPS = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false, stacks: false, pools_quotas: false, ipam_plus: false,
}
const CLUSTER_NODES = [
  { node: 'pve-01', status: 'online', portal_node_id: 1, portal_node_name: 'Cluster A' },
]
const VM_OPTIONS = { bridges: ['vmbr0'], vnets: ['guests'], cpu_types: [], tags: [] }

const POOL = {
  id: 7, kind: 'bridge', network_name: 'vmbr0', node: 'pve-01', vlan_tag: null,
  cidr: '192.168.2.0/24', gateway: '192.168.2.1', dns: ['1.1.1.1'],
  range_start: null, range_end: null, description: 'Prod-Netz',
  created_by: 'admin', created_at: '2026-07-13T10:00:00Z', updated_at: '2026-07-13T10:00:00Z',
}

async function mockCommonApi(page, { me = MOCK_ME_ADMIN } = {}) {
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18' }, packer: { status: 'ready', version: '1.11' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18' }, packer: { status: 'ready', version: '1.11' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: 'core', valid: false, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: 6, max_presets: null, max_api_keys: null, is_plus: false, max_scheduled_jobs_per_user: 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: CAPS }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me/owners', r => r.fulfill({ json: [] }))
  await page.route('**/api/owners/config', r => r.fulfill({ json: { owner_auto_assign_enabled: false, owner_auto_assign_categories: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ json: { quorum: false, node_count: 1, ha_status: null, unreachable_nodes: [] } }))
  await page.route(/localhost:\d+\/api\/cluster\/nodes\/[^/]+\/vm-options(\?.*)?$/, r => r.fulfill({ json: VM_OPTIONS }))
  await page.route(/localhost:\d+\/api\/cluster\/nodes(\?.*)?$/, r => r.fulfill({ json: CLUSTER_NODES }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/approvals/**', r => r.fulfill({ json: { pending: 0 } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  await page.route('**/api/help/**', r => r.fulfill({ json: { content: '', source: 'none' } }))
}

// ── Pool-management surface ─────────────────────────────────────────────────────

test('AC-CORE-UI: IPAM-Area-Tab sichtbar, Pool-Liste rendert die gebundenen Netze', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools(\?.*)?$/, r => r.fulfill({ json: [POOL] }))
  await page.goto('/network?area=ipam')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('button', { name: 'IPAM' })).toBeVisible()
  // Netz-Label "vmbr0 (pve-01)" + CIDR + Gateway.
  await expect(page.getByText('vmbr0 (pve-01)')).toBeVisible()
  await expect(page.getByText('192.168.2.0/24')).toBeVisible()
  await expect(page.getByText('192.168.2.1')).toBeVisible()
})

test('AC-CORE-EMPTY: Ohne Pools zeigt der IPAM-Tab einen Leerzustand statt Fehler', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools(\?.*)?$/, r => r.fulfill({ json: [] }))
  await page.goto('/network?area=ipam')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('Noch keine IP-Pools angelegt.')).toBeVisible()
})

test('AC-CORE-CREATE: Pool anlegen sendet die korrekte Netz-Identität (kind/network_name/node/cidr)', async ({ page }) => {
  let posted = null
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools(\?.*)?$/, r => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON()
      return r.fulfill({ status: 201, json: { ...POOL, ...posted, id: 9 } })
    }
    return r.fulfill({ json: [] })
  })
  await page.goto('/network?area=ipam')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Pool anlegen' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  // Node → vm-options laden → Bridge wählen (kind wird automatisch bridge).
  await page.locator('#ipam-node').selectOption('pve-01')
  await expect(page.locator('#ipam-net option', { hasText: 'vmbr0' })).toBeAttached()
  await page.locator('#ipam-net').selectOption('vmbr0')
  await page.locator('#ipam-cidr').fill('192.168.50.0/24')
  await page.locator('#ipam-gw').fill('192.168.50.1')
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click()

  await expect.poll(() => posted).not.toBeNull()
  expect(posted.kind).toBe('bridge')
  expect(posted.network_name).toBe('vmbr0')
  expect(posted.node).toBe('pve-01')
  expect(posted.cidr).toBe('192.168.50.0/24')
  expect(posted.gateway).toBe('192.168.50.1')
})

test('AC-CORE-DELETE: Pool löschen bestätigt und sendet DELETE', async ({ page }) => {
  let deleted = false
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools\/\d+(\?.*)?$/, r => {
    if (r.request().method() === 'DELETE') { deleted = true; return r.fulfill({ status: 204, body: '' }) }
    return r.fulfill({ json: POOL })
  })
  await page.route(/localhost:\d+\/api\/ipam\/pools(\?.*)?$/, r => r.fulfill({ json: [POOL] }))
  await page.goto('/network?area=ipam')
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: 'Löschen' }).first().click()
  // ConfirmModal
  await expect(page.getByText('IP-Pool löschen')).toBeVisible()
  await page.getByRole('button', { name: 'Löschen' }).last().click()
  await expect.poll(() => deleted).toBe(true)
})

// ── Deploy free-IP suggestion (Story 2) ─────────────────────────────────────────

const PLAYBOOK_LIST = [
  { id: 'vm-clone', name: 'Clone VM', description: 'Test', category: 'vm_deployment', can_execute: true, required_role: null },
]
// Playbook OHNE Bridge-Feld (wie das Starter-Pack: Netz vom Template geerbt).
const PLAYBOOK_NOBRIDGE = {
  id: 'vm-clone', name: 'Clone VM', description: 'Test', category: 'vm_deployment', targets: 'localhost',
  parameters: [
    { id: 'proxmox_node', label: 'Node', type: 'proxmox_node', required: true },
    { id: 'vm_ipconfig', label: 'Netzwerk', type: 'ip_config', required: true, default: 'ip=dhcp' },
  ],
  presets: [],
}

async function mockDeploy(page, { pools = [POOL], suggestIp = '192.168.2.10', detail = PLAYBOOK_NOBRIDGE } = {}) {
  await page.route(/localhost:\d+\/api\/playbooks\/[^/]+$/, r => r.fulfill({ json: detail }))
  await page.route(/localhost:\d+\/api\/playbooks(\?.*)?$/, r => r.fulfill({ json: PLAYBOOK_LIST }))
  await page.route(/localhost:\d+\/api\/ipam\/pools\/available(\?.*)?$/, r => r.fulfill({ json: pools }))
  await page.route(/localhost:\d+\/api\/ipam\/suggest(\?.*)?$/, r =>
    r.fulfill({ json: { pool_id: POOL.id, ip: suggestIp, best_effort: true, reason: suggestIp ? null : 'pool_exhausted' } }))
}

// The bug: a playbook WITHOUT a bridge field (starter-pack) must still offer IPAM.
test('AC-CORE-SUGGEST: Pool-Wähler füllt die IP – auch ohne Bridge-Feld im Playbook', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockDeploy(page)
  await page.goto('/provisioning?tab=vm_deployment')
  await page.waitForLoadState('networkidle')

  await page.getByText('Clone VM').first().click()
  // ip_config auf "Statisch" schalten → Pool-Dropdown erscheint (kein Bridge-Feld nötig).
  await page.getByRole('combobox').filter({ has: page.locator('option[value="static"]') }).selectOption('static')
  await page.getByRole('combobox', { name: 'IP-Pool (IPAM)' }).selectOption(String(POOL.id))
  const btn = page.getByRole('button', { name: 'Freie IP vorschlagen' })
  await expect(btn).toBeVisible()
  await btn.click()
  await expect(page.getByPlaceholder('192.168.1.100')).toHaveValue('192.168.2.10')
})

test('AC-CORE-NOPOOL: Kein Pool angelegt → kein Pool-Dropdown/Button (Fallback wie heute)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockDeploy(page, { pools: [] })
  await page.goto('/provisioning?tab=vm_deployment')
  await page.waitForLoadState('networkidle')

  await page.getByText('Clone VM').first().click()
  await page.getByRole('combobox').filter({ has: page.locator('option[value="static"]') }).selectOption('static')
  await expect(page.getByRole('button', { name: 'Freie IP vorschlagen' })).toHaveCount(0)
})
