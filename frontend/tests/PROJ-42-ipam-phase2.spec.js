// p3portal.org
// PROJ-42 Phase 2 (internal Plus-IPAM) – E2E tests against a mocked API.
// Covers the UI-observable Plus acceptance criteria (all gated ipam_plus):
//  - Sub-tab bar in the IPAM area (Pools/Allocations/Netz-Freigaben/Einstellungen)
//  - Allocations tab: pool usage (used/free/total) + allocation list (IP↔VM)
//  - Manual foreign-IP entry → POST /api/ipam/allocations
//  - Orphans: list + release → DELETE /api/ipam/orphans
//  - Network grants: list + create → POST /api/ipam/grants
//  - Settings: two toggles; toggling global → PUT /api/ipam/config
//  - Core (ipam_plus:false) → no sub-tab bar (Plus surface hidden)
// The reservation lifecycle, race-safety, orphan bidirectionality, grant filtering
// and the 404-gate are covered by the 55 pytest cases in backend/plus/ipam/.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// role=admin, portal_permissions=[manage_settings, manage_ipam]
const ADMIN_TOKEN =
  H + '.eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyIsIm1hbmFnZV9pcGFtIl0sImV4cCI6OTk5OTk5OTk5OSwidXNlcl9pZCI6MX0.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, portal_permissions: ['manage_settings', 'manage_ipam'], groups: [],
}
const CLUSTER_NODES = [{ node: 'pve-01', status: 'online', portal_node_id: 1, portal_node_name: 'Cluster A' }]
const VM_OPTIONS = { bridges: ['vmbr0'], vnets: ['guests'], cpu_types: [], tags: [] }

const POOL = {
  id: 7, kind: 'bridge', network_name: 'vmbr0', node: 'pve-01', vlan_tag: null,
  cidr: '192.168.2.0/24', gateway: '192.168.2.1', dns: [], range_start: null, range_end: null,
  description: 'Prod', created_by: 'admin', created_at: null, updated_at: null,
}
const USAGE = {
  pool_id: 7, total: 253, used: 2, free: 251,
  allocations: [
    { id: 1, pool_id: 7, ip: '192.168.2.10', status: 'confirmed', source: 'proxmox', vmid: 100, owner_username: 'alice' },
    { id: 2, pool_id: 7, ip: '192.168.2.99', status: 'confirmed', source: 'manual', vmid: null, owner_username: 'admin', note: 'Drucker' },
  ],
}
const ORPHANS = [
  { id: 9, pool_id: 7, ip: '192.168.2.55', status: 'orphaned', source: 'proxmox', vmid: 150, owner_username: 'bob' },
]
const GRANTS = [
  { id: 3, kind: 'bridge', network_name: 'vmbr0', node: 'pve-01', vlan_tag: null, grantee_kind: 'group', grantee_id: 4, grantee_name: 'Team A' },
]

function caps(ipamPlus) {
  return {
    config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
    alert_presets: false, auto_snapshots: false, stacks: false, pools_quotas: false,
    vm_dependencies: false, ipam_plus: ipamPlus,
  }
}

async function mockCommonApi(page, { ipamPlus = true } = {}) {
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18' }, packer: { status: 'ready', version: '1.11' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18' }, packer: { status: 'ready', version: '1.11' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: ipamPlus ? 'plus' : 'core', valid: ipamPlus, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: null, max_presets: null, max_api_keys: null, is_plus: ipamPlus, max_scheduled_jobs_per_user: null } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps(ipamPlus) }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me/owners', r => r.fulfill({ json: [] }))
  await page.route('**/api/owners/config', r => r.fulfill({ json: { owner_auto_assign_enabled: false, owner_auto_assign_categories: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: MOCK_ME_ADMIN }))
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
  await page.route('**/api/admin/users', r => r.fulfill({ json: [{ id: 2, username: 'alice' }, { id: 5, username: 'bob' }] }))
  await page.route('**/api/groups', r => r.fulfill({ json: [{ id: 4, name: 'Team A' }] }))
  // Core IPAM pools (used by AllocationsTab selector + IpamPoolsTab)
  await page.route(/localhost:\d+\/api\/ipam\/pools(\?.*)?$/, r => r.fulfill({ json: [POOL] }))
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
})

// ── Sub-tab bar ──────────────────────────────────────────────────────────────

test('AC-P2-SUBTABS: IPAM-Area zeigt die Plus-Sub-Tabs (ipam_plus aktiv)', async ({ page }) => {
  await mockCommonApi(page)
  await page.goto('/network?area=ipam')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: 'Allocations', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Netz-Freigaben', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Einstellungen', exact: true })).toBeVisible()
})

test('AC-P2-CORE-HIDDEN: In Core (ipam_plus:false) gibt es keine Plus-Sub-Tabs', async ({ page }) => {
  await mockCommonApi(page, { ipamPlus: false })
  await page.goto('/network?area=ipam')
  await page.waitForLoadState('networkidle')
  // Pool-Verwaltung sichtbar, aber keine Sub-Tab-Leiste.
  await expect(page.getByRole('button', { name: 'Pool anlegen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Allocations', exact: true })).toHaveCount(0)
})

// ── Allocations ──────────────────────────────────────────────────────────────

test('AC-P2-ALLOC: Allocations-Tab zeigt Auslastung + IP↔VM-Liste', async ({ page }) => {
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools\/\d+\/usage(\?.*)?$/, r => r.fulfill({ json: USAGE }))
  await page.route(/localhost:\d+\/api\/ipam\/orphans(\?.*)?$/, r => r.fulfill({ json: [] }))
  await page.goto('/network?area=ipam&ipamtab=allocations')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('192.168.2.10')).toBeVisible()
  await expect(page.getByText('192.168.2.99')).toBeVisible()
  // Auslastungszahlen (used=2, free=251, total=253)
  await expect(page.getByText('251')).toBeVisible()
  await expect(page.getByText('253')).toBeVisible()
})

test('AC-P2-MANUAL: Fremd-IP manuell eintragen sendet POST /allocations', async ({ page }) => {
  let posted = null
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools\/\d+\/usage(\?.*)?$/, r => r.fulfill({ json: USAGE }))
  await page.route(/localhost:\d+\/api\/ipam\/orphans(\?.*)?$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/ipam\/allocations(\?.*)?$/, r => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON()
      return r.fulfill({ status: 201, json: { id: 3, pool_id: 7, ip: posted.ip, status: 'confirmed', source: 'manual' } })
    }
    return r.fulfill({ json: [] })
  })
  await page.goto('/network?area=ipam&ipamtab=allocations')
  await page.waitForLoadState('networkidle')
  await page.getByPlaceholder('IP-Adresse').fill('192.168.2.200')
  await page.getByRole('button', { name: 'Eintragen' }).click()
  await expect.poll(() => posted).not.toBeNull()
  expect(posted.ip).toBe('192.168.2.200')
  expect(posted.pool_id).toBe(7)
})

test('AC-P2-ORPHANS: verwaiste Allocation freigeben sendet DELETE /orphans', async ({ page }) => {
  let released = false
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/pools\/\d+\/usage(\?.*)?$/, r => r.fulfill({ json: USAGE }))
  await page.route(/localhost:\d+\/api\/ipam\/orphans(\?.*)?$/, r => {
    if (r.request().method() === 'DELETE') { released = true; return r.fulfill({ json: { released: 1 } }) }
    return r.fulfill({ json: ORPHANS })
  })
  await page.goto('/network?area=ipam&ipamtab=allocations')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('192.168.2.55')).toBeVisible()
  // Die Orphan-Zeile (nicht die Allocation-Liste, deren „Freigeben" ein Confirm öffnet).
  await page.locator('li').filter({ hasText: '192.168.2.55' })
    .getByRole('button', { name: 'Freigeben', exact: true }).click()
  await expect.poll(() => released).toBe(true)
})

// ── Network grants ───────────────────────────────────────────────────────────

test('AC-P2-GRANTS: Netz-Freigabe anlegen sendet POST /grants', async ({ page }) => {
  let posted = null
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/grants(\?.*)?$/, r => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON()
      return r.fulfill({ status: 201, json: { id: 10, ...posted, grantee_name: 'alice' } })
    }
    return r.fulfill({ json: GRANTS })
  })
  await page.goto('/network?area=ipam&ipamtab=grants')
  await page.waitForLoadState('networkidle')
  // Bestehende Freigabe sichtbar
  await expect(page.getByText('vmbr0 (pve-01)')).toBeVisible()
  await page.getByRole('button', { name: 'Freigabe anlegen' }).first().click()
  // Netz + Grantee im Formular wählen
  await page.locator('select').nth(0).selectOption('pve-01')   // Node
  await page.locator('select').nth(1).selectOption('vmbr0')    // Netz
  // Grantee-Typ bleibt "user"; Empfänger wählen
  await page.getByRole('combobox').last().selectOption('2')
  await page.getByRole('button', { name: 'Freigabe anlegen' }).last().click()
  await expect.poll(() => posted).not.toBeNull()
  expect(posted.kind).toBe('bridge')
  expect(posted.network_name).toBe('vmbr0')
  expect(posted.grantee_kind).toBe('user')
  expect(posted.grantee_id).toBe(2)
})

// ── Settings (toggles) ───────────────────────────────────────────────────────

test('AC-P2-SETTINGS: globaler Toggle sendet PUT /config', async ({ page }) => {
  let put = null
  await mockCommonApi(page)
  await page.route(/localhost:\d+\/api\/ipam\/config(\?.*)?$/, r => {
    if (r.request().method() === 'PUT') {
      put = r.request().postDataJSON()
      return r.fulfill({ json: { global_enabled: true, strict_network_visibility: false } })
    }
    return r.fulfill({ json: { global_enabled: false, strict_network_visibility: false, updated_by: null, updated_at: null } })
  })
  await page.goto('/network?area=ipam&ipamtab=settings')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('IPAM aktiv (zustandsbehaftet)')).toBeVisible()
  // Erster Toggle-Button in der Settings-Section = global_enabled.
  await page.locator('main button.rounded-full').first().click()
  await expect.poll(() => put).not.toBeNull()
  expect(put.global_enabled).toBe(true)
})
