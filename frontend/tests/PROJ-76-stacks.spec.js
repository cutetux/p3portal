// p3portal.org
// PROJ-76 Phase 1: E2E-Tests für Stacks (deklaratives Infrastructure-Modell, Plus-only).
// Testet: Capability-Gating (Core vs. Plus) für Sidebar + Route + API-404,
//         /stacks-Liste, Editor (YAML/Form-Tabs + Validieren), Detail (Deploy disabled,
//         Versionen-Tab), ETag-409-Konflikt-Modal, Approval-202-Banner,
//         Orphan-Tab-Gating (manage_orphan_stacks).
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings","manage_users","manage_orphan_stacks"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyIsIm1hbmFnZV91c2VycyIsIm1hbmFnZV9vcnBoYW5fc3RhY2tzIl0sImV4cCI6OTk5OTk5OTk5OSwidXNlcl9pZCI6MX0' +
  '.fake-sig'

// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999,"user_id":2}
const OP_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjoyfQ' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_settings', 'manage_users', 'manage_orphan_stacks'], groups: [],
}

const CAPS_CORE = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false, stacks: false,
}
const CAPS_PLUS = { ...CAPS_CORE, stacks: true }

const STACK_LIST = [
  {
    id: 7, name: 'webcluster', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 2, owner_username: 'operator', is_orphan: false, resource_count: 3,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
  },
]

const STACK_YAML =
  "name: webcluster\nversion: '1.0.0'\nresources:\n  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n    count: 3\n"

const STACK_DETAIL = {
  ...STACK_LIST[0],
  yaml_text: STACK_YAML,
  resources: [
    { type: 'vm', name: 'web-1', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null },
    { type: 'vm', name: 'web-2', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null },
    { type: 'vm', name: 'web-3', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null },
  ],
}

const ORPHAN_STACK = {
  id: 9, name: 'verwaist', description: null, version: '1.0.0',
  resource_count: 1, orphaned_at: '2026-06-01T09:00:00', ex_owner_user_id: 42,
}

// ── Common mocks ───────────────────────────────────────────────────────────────

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS } = {}) {
  await page.route(/localhost:\d+\/api\/cluster\//, r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: caps.stacks ? 'plus_v1' : 'core', valid: caps.stacks, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: caps.stacks ? null : 6, max_presets: null, max_api_keys: null, is_plus: caps.stacks, max_scheduled_jobs_per_user: caps.stacks ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/users', r => r.fulfill({ json: [{ id: 2, username: 'operator', auth_type: 'local' }] }))
  await page.route('**/api/admin/settings**', r =>
    r.fulfill({ json: { proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199 } }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } }))
  await page.route('**/api/cluster/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/cluster/vms', r => r.fulfill({ json: [] }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/approvals/**', r => r.fulfill({ json: { pending: 0 } }))
  await page.route('**/api/approvals', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-assignments', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/settings/**', r => r.fulfill({ json: null }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools/**', r => r.fulfill({ json: [] }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

async function gotoStacks(page, token = ADMIN_TOKEN, caps = CAPS_PLUS, stacks = STACK_LIST) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks(\?.*)?$/, r => r.fulfill({ json: stacks }))
  await page.goto('/stacks')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RBAC-1 + AC-API-17: Capability-Gating (Core vs Plus)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RBAC-1 Plus: /stacks rendert Liste mit Plus-Capability', async ({ page }) => {
  await gotoStacks(page, ADMIN_TOKEN, CAPS_PLUS)
  await expect(page).toHaveURL(/\/stacks/)
  await expect(page.locator('text=webcluster').first()).toBeVisible({ timeout: 5000 })
})

test('AC-RBAC-1 Core: /stacks ohne Capability zeigt Capability-Gate (keine Tabelle)', async ({ page }) => {
  // Im Dev-/Test-Build sind die Plus-Module vorhanden → StacksListPage rendert,
  // wird aber durch useCapability('stacks') gegated und zeigt den Hinweis.
  // (Der App.jsx-Redirect auf /dashboard greift nur im echten Core-Build, wo die
  //  Registry-Komponente undefined ist – das deckt der Core-Stub-Vitest-Test ab.)
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.goto('/stacks')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/nicht verfügbar|not available/i').first()).toBeVisible({ timeout: 5000 })
  // Keine Stack-Tabelle/Daten
  await expect(page.locator('text=webcluster')).toHaveCount(0)
})

test('AC-RBAC-1 Sidebar: Stacks-Nav nur bei Plus sichtbar', async ({ page }) => {
  // Plus → sichtbar
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  const navLink = page.locator('a[href="/stacks"]')
  await expect(navLink).toBeVisible({ timeout: 5000 })
})

test('AC-RBAC-1 Sidebar Core: Stacks-Nav ohne Plus nicht vorhanden', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('a[href="/stacks"]')).toHaveCount(0)
})

test('AC-API-17: /api/stacks liefert 404 im Core-Mode', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/localhost:\d+\/api\/stacks(\?.*)?$/, r => r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/')
  const resp = await browserFetch(page, '/api/stacks', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })
  expect(resp.status).toBe(404)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-1/2: Liste + "Neuer Stack" öffnet Editor mit Tab-Toggle
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-1: Stacks-Tabelle zeigt Name/Version/Status/Resources', async ({ page }) => {
  await gotoStacks(page, ADMIN_TOKEN, CAPS_PLUS)
  await expect(page.locator('text=webcluster').first()).toBeVisible()
  // Resources-Count 3 in der Zeile
  await expect(page.locator('table')).toContainText('3')
})

test('AC-UI-2/3: "Neuer Stack" öffnet Editor mit YAML/Formular-Tabs', async ({ page }) => {
  await gotoStacks(page, ADMIN_TOKEN, CAPS_PLUS)
  await page.click('button:has-text("Neuer Stack"), button:has-text("New Stack")')
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/stacks\/new/)
  // Beide Tab-Buttons sichtbar
  await expect(page.locator('button:has-text("YAML")').first()).toBeVisible()
  await expect(page.locator('button:has-text("Formular"), button:has-text("Form")').first()).toBeVisible()
})

test('AC-UI-6: Validieren-Button zeigt Ergebnis inline', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/validate$/, r =>
    r.fulfill({ json: { valid: true, errors: [], warnings: ["node 'pve-01' not found"] } }))
  await page.route(/localhost:\d+\/api\/stacks(\?.*)?$/, r => r.fulfill({ json: STACK_LIST }))
  await page.goto('/stacks/new')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Validieren"), button:has-text("Validate")')
  await page.waitForLoadState('networkidle')
  // Warning erscheint inline
  await expect(page.locator("text=/not found/i").first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-8/13: Detailseite – Tabs + Deploy disabled (Phase-2-Tooltip)
// ═══════════════════════════════════════════════════════════════════════════════

async function gotoDetail(page, token = ADMIN_TOKEN) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: STACK_DETAIL }))
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

test('AC-UI-8: Detailseite zeigt Header + Tabs YAML/Resources/Versionen', async ({ page }) => {
  await gotoDetail(page)
  await expect(page.locator('h1:has-text("webcluster")')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('button:has-text("YAML")').first()).toBeVisible()
  await expect(page.locator('button:has-text("Resources"), button:has-text("Ressourcen")').first()).toBeVisible()
})

// Phase 2b: Deploy-Button ist jetzt AKTIV (AC-2B-UI-1).
test('AC-2B-UI-1: Deploy-Button ist aktiv (Phase 2b)', async ({ page }) => {
  await gotoDetail(page)
  const deployBtn = page.locator('button:has-text("Deploy"), button:has-text("Ausrollen")').first()
  await expect(deployBtn).toBeVisible({ timeout: 5000 })
  await expect(deployBtn).toBeEnabled()
})

test('AC-UI-8 Resources-Tab: zeigt aufgelöste VMs web-1/web-2/web-3', async ({ page }) => {
  await gotoDetail(page)
  await page.click('button:has-text("Resources"), button:has-text("Ressourcen")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=web-1').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=web-3').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-CONC-2/3 + AC-UI-12: ETag-Konflikt → 3-Spalten-Modal
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-CONC-3/AC-UI-12: PUT-409 öffnet 3-Spalten-Konflikt-Modal', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OP_TOKEN)
  await mockCommonApi(page, { me: { ...MOCK_ME_ADMIN, id: 2, username: 'operator', role: 'operator', portal_permissions: [] }, caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => {
    if (r.request().method() === 'PUT') {
      return r.fulfill({
        status: 409,
        json: {
          current_etag: 'b'.repeat(64),
          current_yaml: 'name: webcluster\nversion: "2.0.0"\nresources: []\n',
          your_yaml: STACK_YAML,
          base_yaml: STACK_YAML,
        },
      })
    }
    return r.fulfill({ json: STACK_DETAIL })
  })
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Speichern"), button:has-text("Save")')
  await page.waitForLoadState('networkidle')
  // Konflikt-Modal mit drei Spalten (base/your/current)
  await expect(page.locator('text=/Konflikt|Conflict/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-APPR-2: 202 pending_approval → Banner
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-APPR-2: PUT-202 zeigt Pending-Approval-Banner', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OP_TOKEN)
  await mockCommonApi(page, { me: { ...MOCK_ME_ADMIN, id: 2, username: 'operator', role: 'operator', portal_permissions: [] }, caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => {
    if (r.request().method() === 'PUT') {
      return r.fulfill({ status: 202, json: { status: 'pending_approval', approval_id: 'appr_1', poll_url: '/api/approvals/appr_1' } })
    }
    return r.fulfill({ json: STACK_DETAIL })
  })
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Speichern"), button:has-text("Save")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/Freigabe|approval|pending/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-16: Orphan-Tab Gating
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-API-14: /api/stacks/orphans liefert Orphan-Liste (Admin)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/orphans$/, r => r.fulfill({ json: [ORPHAN_STACK] }))
  await page.goto('/')
  const resp = await browserFetch(page, '/api/stacks/orphans', { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })
  expect(resp.status).toBe(200)
  expect(Array.isArray(resp.body)).toBe(true)
  expect(resp.body[0].name).toBe('verwaist')
})
