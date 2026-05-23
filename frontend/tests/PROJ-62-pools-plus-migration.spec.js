// p3portal.org
// PROJ-62: E2E-Tests für Pools-Plus-Migration
// Prüft: Registry-Einbindung, Capability-Gate, Ownerless-Badge, 412-Quota-Banner
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ─────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_pools"],"exp":9999999999,"jti":"admin-proj62"}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9wb29scyJdLCJleHAiOjk5OTk5OTk5OTksImp0aSI6ImFkbWluLXByb2o2MiJ9' +
  '.fake-sig'

// ── Capabilities: Core vs. Plus ────────────────────────────────────────────
const CAPS_CORE = {
  alert_presets: false,
  alerts_smtp: false,
  theme_editor: false,
  multiple_nodes: false,
  default_node: false,
  scheduled_jobs: false,
  language_change: false,
  cluster_resources_packer: false,
  multi_node_dashboard: false,
  api_key_max_count_override: false,
  api_key_scopes_full: false,
  sidebar_pins_extended: false,
  compute_alerting: false,
  compute_scheduled_jobs: false,
  approval_workflow: false,
  help_global_overrides: false,
  pools_quotas: false,
  groups_unlimited: false,
  node_assignments: false,
  owners_unlimited: false,
}

const CAPS_PLUS = { ...CAPS_CORE, pools_quotas: true }

// ── Mock-Pools-Daten ────────────────────────────────────────────────────────
const POOL_WITH_OWNER = {
  id: 1,
  name: 'Web-Team',
  description: 'Webserver Pool',
  tags: ['prod'],
  owner_subject_type: 'user',
  owner_subject_id: 2,
  owner_display: 'alice',
  vm_count_quota: 5,
  cpu_quota: 10,
  ram_quota_mb: 16384,
  disk_quota_gb: 200,
  member_count: 2,
  used_vm_count: 3,
  used_cpu: 8,
  used_ram_mb: 12288,
  used_disk_gb: 80,
  created_at: '2026-05-12T10:00:00Z',
  created_by: 'admin',
}

const POOL_OWNERLESS = {
  id: 2,
  name: 'DevStage',
  description: null,
  tags: [],
  owner_subject_type: null,
  owner_subject_id: null,
  owner_display: null,
  vm_count_quota: 0,
  cpu_quota: 0,
  ram_quota_mb: 0,
  disk_quota_gb: 0,
  member_count: 1,
  used_vm_count: 1,
  used_cpu: 2,
  used_ram_mb: 2048,
  used_disk_gb: 32,
  created_at: '2026-05-12T11:00:00Z',
  created_by: 'admin',
}

// ── Mock-Playbook (für PlaybookForm-Test) ─────────────────────────────────
const MOCK_PLAYBOOK = {
  id: 'vm_deploy',
  name: 'VM Provisionieren',
  description: 'Erstellt eine neue VM',
  category: 'vm_deployment',
  parameters: [
    { id: 'vm_name', label: 'VM Name', type: 'string', required: true, default: '' },
  ],
  presets: [],
  can_execute: true,
}

// ── 412-Quota-Detail (strukturiert wie Backend antwortet) ──────────────────
const QUOTA_ERROR_DETAIL = {
  error: 'pool_quota_exceeded',
  pool_id: 1,
  exceeded: ['cpu', 'ram_mb'],
  current: { cpu: 8, ram_mb: 12288, disk_gb: 80, vm_count: 3 },
  requested: { cpu: 4, ram_mb: 8192, disk_gb: 50, vm_count: 1 },
  limit: { cpu: 10, ram_mb: 16384, disk_gb: 200, vm_count: 5 },
}

// ── Helfer ────────────────────────────────────────────────────────────────
async function mockCommonApi(page, { caps = CAPS_CORE } = {}) {
  // Catch-all LIFO: zuerst registrieren = letzte Priorität
  await page.route('**/api/cluster/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.route('**/api/capabilities', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(caps) }))

  await page.route('**/api/license/status', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        edition: caps.pools_quotas ? 'plus_v1' : 'core',
        valid: caps.pools_quotas,
        contact_name: null, expiry: null, reason: null,
      }),
    }))

  await page.route('**/api/license/limits', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        max_users: caps.pools_quotas ? null : 6,
        max_presets: caps.pools_quotas ? null : 5,
        max_api_keys: 3,
        is_plus: caps.pools_quotas,
      }),
    }))

  await page.route('**/api/admin/nodes', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'pve01', host: '192.168.1.10', is_cluster: false, is_default: true }]),
    }))

  await page.route('**/api/admin/announcements', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.route('**/api/me/preferences', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ theme_preference: null, lang_preference: null }),
    }))

  await page.route('**/api/me/pools', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.route('**/api/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.route('**/api/themes/active', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '"dark"' }))

  await page.route('**/api/themes', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: '1', name: 'Dark', is_builtin: true, is_active: true }]),
    }))
}

async function mockPoolsApi(page, pools = [POOL_WITH_OWNER, POOL_OWNERLESS]) {
  await page.route('**/api/pools/tags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: ['prod'] }) }))

  await page.route('**/api/pools*', r => {
    const url = r.request().url()
    if (url.includes('/tags')) {
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: ['prod'] }) })
    }
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pools) })
    } else {
      r.continue()
    }
  })

  await page.route('**/api/admin/users', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, username: 'admin', role: 'admin', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
        { id: 2, username: 'alice', role: 'operator', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
      ]),
    }))

  await page.route('**/api/rbac/presets', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-CAPABILITIES-2: Pools-Tab in System-Settings nur bei pools_quotas=true
// ═══════════════════════════════════════════════════════════════════════════

test('AC-CAPABILITIES-2: Core-Edition (pools_quotas=false) – Pools-Tab nicht sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await mockPoolsApi(page, [])

  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')

  // Pools-Sub-Tab darf nicht sichtbar sein
  await expect(page.getByRole('button', { name: 'Pools' })).not.toBeVisible()
})

test('AC-CAPABILITIES-2: Plus-Edition (pools_quotas=true) – Pools-Tab sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPoolsApi(page)

  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')

  // Pools-Sub-Tab muss sichtbar sein
  await expect(page.getByRole('button', { name: 'Pools' })).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-MOVE-3: Registry enthält PoolsPage und PoolsTab
// ═══════════════════════════════════════════════════════════════════════════

test('AC-MOVE-3: Plus-Tab "Pools" rendert PoolsPage (aus Registry)', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPoolsApi(page)

  await page.goto('/system-settings?tab=users&sub=pools')
  await page.waitForLoadState('networkidle')

  // Pools-Inhalt ist sichtbar – zeigt Pool-Tabelle oder Empty-State
  await expect(
    page.getByText('Web-Team').or(page.getByText('Noch keine Pools vorhanden.'))
  ).toBeVisible()
})

test('AC-MOVE-3: MyAccount zeigt Pools-Tab (PoolsTab aus Registry)', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPoolsApi(page, [])

  await page.route('**/api/profile', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'admin', email: '', groups: [] }),
    }))
  await page.route('**/api/user-api-keys', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/account?tab=pools')
  await page.waitForLoadState('networkidle')

  // Pools-Tab ist aktiv (Tab-Schaltfläche)
  await expect(page.getByRole('button', { name: 'Pools' })).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-CLEANUP-6: Ownerless-Badge in Pools-Übersicht
// ═══════════════════════════════════════════════════════════════════════════

test('AC-CLEANUP-6: Pool ohne Owner zeigt Ownerless-Badge', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPoolsApi(page, [POOL_OWNERLESS])

  await page.goto('/system-settings?tab=users&sub=pools')
  await page.waitForLoadState('networkidle')

  // "DevStage" ist ownerless → Ownerless-Badge sichtbar
  await expect(page.getByText('DevStage', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Kein Owner zugewiesen')).toBeVisible()
})

test('AC-CLEANUP-6: Pool mit Owner zeigt keinen Ownerless-Badge', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPoolsApi(page, [POOL_WITH_OWNER])

  await page.goto('/system-settings?tab=users&sub=pools')
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Kein Owner zugewiesen')).not.toBeVisible()
})

test('AC-CLEANUP-6: Gemischte Pool-Liste – genau ein Ownerless-Badge', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPoolsApi(page, [POOL_WITH_OWNER, POOL_OWNERLESS])

  await page.goto('/system-settings?tab=users&sub=pools')
  await page.waitForLoadState('networkidle')

  const badges = page.getByTitle('Kein Owner zugewiesen')
  await expect(badges).toHaveCount(1)
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-QUOTA-6: PlaybookForm zeigt strukturiertes 412-Banner
// ═══════════════════════════════════════════════════════════════════════════

test('AC-QUOTA-6: PlaybookForm zeigt QuotaErrorBanner bei 412 pool_quota_exceeded', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })

  // Pools-API für Selektor
  await page.route('**/api/pools*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([POOL_WITH_OWNER]) }))

  // Playbooks-Liste
  await page.route(/localhost:\d+\/api\/playbooks$/, r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PLAYBOOK]),
    }))

  // Playbook-Detail (wird beim Klick auf PlaybookCard geladen)
  await page.route(/localhost:\d+\/api\/playbooks\/vm_deploy/, r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_PLAYBOOK),
    }))

  // Job-Start antwortet mit 412 und strukturiertem Detail
  await page.route('**/api/jobs', r => {
    if (r.request().method() === 'POST') {
      r.fulfill({
        status: 412,
        contentType: 'application/json',
        body: JSON.stringify({ detail: QUOTA_ERROR_DETAIL }),
      })
    } else {
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.route('**/api/node-default-templates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

  await page.route('**/api/owners/config', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ owner_auto_assign_enabled: false, owner_auto_assign_categories: [] }),
    }))

  // BUG-62-4 Fix: korrekte Route /provisioning statt /playbooks/vm_deploy
  await page.goto('/provisioning')
  await page.waitForLoadState('networkidle')

  // Playbook aus der Liste auswählen
  await page.getByText('VM Provisionieren').click()
  await page.waitForLoadState('networkidle')

  // Pflichtfeld füllen und Formular absenden
  // fill() wartet automatisch bis das Element sichtbar ist (Playwright-Retry)
  await page.getByLabel('VM Name').fill('test-vm')

  await page.getByRole('button', { name: /start/i }).click()
  await page.waitForLoadState('networkidle')

  // QuotaErrorBanner muss sichtbar sein
  await expect(page.getByRole('alert')).toBeVisible()

  // Überschrittene Dimensionen sind sichtbar (CPU und RAM)
  await expect(page.getByText('CPU-Kerne')).toBeVisible()
  await expect(page.getByText('RAM')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-TEST-5: Owner-Delete → Pool wird ownerless (via Mock-API simuliert)
// ═══════════════════════════════════════════════════════════════════════════

test('AC-TEST-5: Pool nach User-Delete als ownerless sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })

  // Phase 1: Pool hat Owner (alice, ID 2)
  let pools = [{ ...POOL_WITH_OWNER }]

  await page.route('**/api/pools/tags', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"tags":[]}' }))

  await page.route('**/api/pools*', r => {
    if (r.request().method() === 'GET' && !r.request().url().includes('/tags')) {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pools) })
    } else {
      r.continue()
    }
  })

  await page.route('**/api/admin/users', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, username: 'admin', role: 'admin', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
        { id: 2, username: 'alice', role: 'operator', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
      ]),
    }))

  await page.route('**/api/rbac/presets', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/system-settings?tab=users&sub=pools')
  await page.waitForLoadState('networkidle')

  // Pool hat Owner → kein Ownerless-Badge
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Kein Owner zugewiesen')).not.toBeVisible()

  // Phase 2: User alice wurde gelöscht → Pool ist jetzt ownerless
  pools = [{ ...POOL_WITH_OWNER, owner_subject_type: null, owner_subject_id: null, owner_display: null }]

  // Seite neu laden → Pool-API gibt jetzt ownerless zurück
  await page.reload()
  await page.waitForLoadState('networkidle')

  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()
  await expect(page.getByTitle('Kein Owner zugewiesen')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-PURE-CORE-3: Core-Edition (pools_quotas=false) – Pools-Inhalt ausgeblendet
// ═══════════════════════════════════════════════════════════════════════════

test('AC-PURE-CORE-3: Core-Edition zeigt keinen Pools-Tab in System-Settings', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })

  await page.goto('/system-settings?tab=users&sub=pools')
  await page.waitForLoadState('networkidle')

  // Kein Pools-Tab-Button sichtbar
  await expect(page.getByRole('button', { name: 'Pools' })).not.toBeVisible()

  // Kein Pool-Inhalt gerendert
  await expect(page.getByText('Web-Team')).not.toBeVisible()
  await expect(page.getByText('Neuer Pool')).not.toBeVisible()
})
// p3portal.org
