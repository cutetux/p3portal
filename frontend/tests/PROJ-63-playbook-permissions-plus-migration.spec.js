// p3portal.org
// PROJ-63: E2E-Tests für Playbook-Rechte-Plus-Migration
// Prüft: Capability-Gate (Tab/Profil/UserForm), Registry-Einbindung, Core-UI-Bereinigung
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ─────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_playbook_permissions"],"exp":9999999999,"jti":"admin-proj63"}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9wbGF5Ym9va19wZXJtaXNzaW9ucyJdLCJleHAiOjk5OTk5OTk5OTksImp0aSI6ImFkbWluLXByb2o2MyJ9' +
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
  playbook_permissions: false,
}

const CAPS_PLUS = { ...CAPS_CORE, playbook_permissions: true, pools_quotas: true }

// ── Mock-Playbook-Permissions-Daten ────────────────────────────────────────
const MOCK_PERMISSION = {
  id: 1,
  playbook_name: 'vm_deploy',
  subject_type: 'user',
  subject_id: 2,
  display_name: 'alice',
  added_at: '2026-05-17T10:00:00Z',
  added_by_user_id: 1,
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
        edition: caps.playbook_permissions ? 'plus_v1' : 'core',
        valid: caps.playbook_permissions,
        contact_name: null, expiry: null, reason: null,
      }),
    }))

  await page.route('**/api/license/limits', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        max_users: caps.playbook_permissions ? null : 6,
        max_presets: caps.playbook_permissions ? null : 5,
        max_api_keys: 3,
        is_plus: caps.playbook_permissions,
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

async function mockPlaybookPermissionsApi(page) {
  await page.route(/localhost:\d+\/api\/playbook-permissions.*/, r => {
    const url = r.request().url()
    if (url.includes('/config')) {
      return r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ default_mode: 'open', updated_at: null, updated_by_user_id: null }),
      })
    }
    if (url.includes('/permissions') && r.request().method() === 'GET') {
      return r.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([MOCK_PERMISSION]),
      })
    }
    r.continue()
  })

  await page.route('**/api/playbooks', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'vm_deploy', name: 'VM Provisionieren', description: 'Erstellt eine neue VM',
          category: 'vm_deployment', parameters: [], presets: [], can_execute: true,
        },
      ]),
    }))
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-CAPABILITIES-3: Playbook-Rechte-Tab in System-Settings Capability-Gate
// ═══════════════════════════════════════════════════════════════════════════

test('AC-CAPABILITIES-3: Core-Edition (playbook_permissions=false) – Playbook-Rechte-Tab nicht sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })

  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')

  // Playbook-Rechte-Sub-Tab darf nicht sichtbar sein
  const playbookRechteBtn = page.getByRole('button', { name: /playbook.rechte/i })
  await expect(playbookRechteBtn).not.toBeVisible()
})

test('AC-CAPABILITIES-3: Plus-Edition (playbook_permissions=true) – Playbook-Rechte-Tab sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPlaybookPermissionsApi(page)

  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')

  // Playbook-Rechte-Sub-Tab muss sichtbar sein
  const playbookRechteBtn = page.getByRole('button', { name: /playbook.rechte/i })
  await expect(playbookRechteBtn).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-MOVE-3: Registry enthält PlaybookPermissionsPage (Tab-Inhalt rendert)
// ═══════════════════════════════════════════════════════════════════════════

test('AC-MOVE-3: Plus-Tab "Playbook-Rechte" rendert PlaybookPermissionsPage aus Registry', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPlaybookPermissionsApi(page)

  await page.goto('/system-settings?tab=users&sub=playbook_permissions')
  await page.waitForLoadState('networkidle')

  // Tab-Inhalt ist sichtbar – Whitelist-Tabelle oder Empty-State
  await expect(
    page.getByText('VM Provisionieren').or(page.getByText('Keine Einträge vorhanden'))
  ).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-CAPABILITIES-4: PermissionsPage AllowedPlaybooksSection Gate
// ═══════════════════════════════════════════════════════════════════════════

test('AC-CAPABILITIES-4: Core-Edition – Profil-Sektion "Freigegebene Playbooks" nicht sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })

  await page.route('**/api/me/permissions', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ role: 'admin', proxmox_user: null, portal_permissions: [], node_assignments: [] }),
    }))

  await page.goto('/permissions')
  await page.waitForLoadState('networkidle')

  // Abschnitt "Freigegebene Playbooks" darf nicht sichtbar sein (i18n: permissions.section_allowed_playbooks)
  await expect(page.getByText('Freigegebene Playbooks')).not.toBeVisible()
})

test('AC-CAPABILITIES-4: Plus-Edition – Profil-Sektion "Freigegebene Playbooks" sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await mockPlaybookPermissionsApi(page)

  await page.route('**/api/me/permissions', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ role: 'admin', proxmox_user: null, portal_permissions: [], node_assignments: [] }),
    }))
  // auth_type='local' → usePermissions ruft auch fetchMyPermissions() → /api/rbac/me/permissions
  await page.route('**/api/rbac/me/permissions', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ role: 'admin', presets: [], node_assignments: [] }),
    }))
  await page.route('**/api/me/playbook-permissions', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/permissions')
  await page.waitForLoadState('networkidle')

  // Abschnitt "Freigegebene Playbooks" muss sichtbar sein (i18n: permissions.section_allowed_playbooks)
  await expect(page.getByText('Freigegebene Playbooks')).toBeVisible({ timeout: 8000 })
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-CAPABILITIES-5: UserForm Permission-Picker (manage_playbook_permissions)
// ═══════════════════════════════════════════════════════════════════════════

test('AC-CAPABILITIES-5: Core-Edition – manage_playbook_permissions nicht in UserForm', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })

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
  await page.route('**/api/admin/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')

  // Bearbeiten-Button für alice anklicken
  const editBtns = page.getByRole('button', { name: /bearbeiten/i })
  await editBtns.last().click()
  await page.waitForLoadState('networkidle')

  // manage_playbook_permissions darf nicht im UserForm sichtbar sein (i18n: perm_manage_playbook_permissions)
  await expect(page.getByText('Playbook-Berechtigungen verwalten')).not.toBeVisible()
})

test('AC-CAPABILITIES-5: Plus-Edition – manage_playbook_permissions in UserForm sichtbar', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  // BUG-63-1: extra_portal_permissions muss manuell im Mock ergänzt werden,
  // da Backend aktuell keine extra_portal_permissions in /api/capabilities liefert
  await mockCommonApi(page, { caps: { ...CAPS_PLUS, extra_portal_permissions: ['manage_pools', 'manage_playbook_permissions'] } })
  await mockPlaybookPermissionsApi(page)

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
  await page.route('**/api/admin/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')

  const editBtns = page.getByRole('button', { name: /bearbeiten/i })
  await editBtns.last().click()
  await page.waitForLoadState('networkidle')

  // manage_playbook_permissions muss im UserForm sichtbar sein (i18n: perm_manage_playbook_permissions)
  await expect(page.getByText('Playbook-Berechtigungen verwalten')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════
// AC-PURE-CORE-1: /admin/playbook-permissions in Core (Redirect auf System-Settings)
// ═══════════════════════════════════════════════════════════════════════════

test('AC-PURE-CORE-1: Core-Edition – /admin/playbook-permissions wird korrekt weitergeleitet', async ({ page }) => {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })

  await page.goto('/admin/playbook-permissions')
  await page.waitForLoadState('networkidle')

  // Route leitet auf System-Settings um (kein 404-Screen)
  await expect(page).toHaveURL(/system-settings/)
})
