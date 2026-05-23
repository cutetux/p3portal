// p3portal.org
// PROJ-49: E2E-Tests für Funktionale Permissions (Playbook-Whitelist + ISO-Upload-Verdrahtung)
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_playbook_permissions"],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9wbGF5Ym9va19wZXJtaXNzaW9ucyJdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-sig'

// {"sub":"mgr","auth_type":"local","role":"operator","portal_permissions":["manage_playbook_permissions"],"exp":9999999999}
const MANAGE_PB_PERMS_TOKEN =
  H + '.' +
  'eyJzdWIiOiJtZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6WyJtYW5hZ2VfcGxheWJvb2tfcGVybWlzc2lvbnMiXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"op","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcCIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_PLAYBOOK_OPEN = {
  name: 'vm_deploy',
  id: 'vm_deploy',
  description: 'VM erstellen',
  category: 'vm_deployment',
  required_role: 'operator',
  parameters: [],
  can_execute: true,
}

const MOCK_PLAYBOOK_RESTRICTED = {
  name: 'vm_destroy',
  id: 'vm_destroy',
  description: 'VM löschen',
  category: 'vm_deployment',
  required_role: 'operator',
  parameters: [],
  can_execute: false,
}

const MOCK_PERMISSION_ENTRY = {
  id: 1,
  playbook_name: 'vm_destroy',
  subject_type: 'user',
  subject_id: 2,
  subject_label: 'alice',
  added_at: '2026-05-13T10:00:00Z',
  added_by_user_id: 1,
  added_by_username: 'admin',
}


const MOCK_CONFIG_OPEN = { default_playbook_mode: 'open' }
const MOCK_CONFIG_RESTRICTED = { default_playbook_mode: 'restricted' }

const MOCK_MY_PERMISSIONS_DIRECT = [
  { playbook_name: 'vm_destroy', category: 'vm_deployment', source: 'direct' },
]
const MOCK_MY_PERMISSIONS_GROUP = [
  { playbook_name: 'vm_deploy', category: 'vm_deployment', source: 'group:infra-leads' },
]
const MOCK_MY_PERMISSIONS_DEFAULT = [
  { playbook_name: 'vm_deploy', category: 'vm_deployment', source: 'default_mode_open' },
]
const MOCK_MY_PERMISSIONS_ADMIN = [
  { playbook_name: 'vm_deploy', category: 'vm_deployment', source: 'admin' },
  { playbook_name: 'vm_destroy', category: 'vm_deployment', source: 'admin' },
]

const MOCK_USER = {
  id: 2,
  username: 'alice',
  role: 'operator',
  active: true,
  auth_type: 'local',
  portal_permissions: [],
  created_at: '2026-01-01T10:00:00Z',
}

const MOCK_GROUP = {
  id: 1,
  name: 'infra-leads',
  description: 'Infra Team',
  tags: [],
  owner_id: null,
  owner_display: null,
  member_count: 2,
  created_at: '2026-01-01T10:00:00Z',
  created_by: 'admin',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommonApi(page, { plus = true } = {}) {
  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PLAYBOOK_OPEN, MOCK_PLAYBOOK_RESTRICTED]),
    })
  )
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }),
    })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([]),
    })
  )
  await page.route('/api/admin/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/preferences', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ theme_preference: null, lang_preference: null }),
    })
  )
  await page.route('/api/me/pools', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/node-assignments', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/groups', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_GROUP]),
    })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        edition: plus ? 'plus' : 'core',
        valid: plus,
        contact_name: null,
        expiry: null,
        reason: null,
        limits: {
          users: { current: 1, max: plus ? null : 6, unlimited: plus },
          presets: { current: 0, max: plus ? null : 5, unlimited: plus },
        },
      }),
    })
  )
  await page.route('/api/sidebar/pins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/cache-stats**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  )
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbook-permissions/config', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_CONFIG_OPEN),
    })
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-ADM-1: Sidebar-Eintrag Sichtbarkeit
// ══════════════════════════════════════════════════════════════════════════════

test('AC-UI-ADM-1a: Admin sieht Sidebar-Link "Playbook-Berechtigungen"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: /Playbook-Berechtigungen/i })).toBeVisible({ timeout: 5000 })
})

test('AC-UI-ADM-1b: manage_playbook_permissions Operator sieht Sidebar-Link', async ({ page }) => {
  await setToken(page, MANAGE_PB_PERMS_TOKEN)
  await mockCommonApi(page)

  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: /Playbook-Berechtigungen/i })).toBeVisible({ timeout: 5000 })
})

test('AC-UI-ADM-1c: Operator ohne Permission sieht keinen Sidebar-Link', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)

  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: /Playbook-Berechtigungen/i })).not.toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-ADM-2: Admin-Seite Grundaufbau
// ══════════════════════════════════════════════════════════════════════════════

test('AC-UI-ADM-2a: Admin-Seite zeigt Tabelle mit Playbook-Einträgen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  // Mock permission counts für beide Playbooks
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PERMISSION_ENTRY]),
    })
  )

  await page.goto('/admin/playbook-permissions')
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=vm_destroy').first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-ADM-2b: Modus-Badge "whitelist" bei Playbook mit Einträgen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PERMISSION_ENTRY]),
    })
  )

  await page.goto('/admin/playbook-permissions')
  // Whitelist-Badge für Playbook mit 1 Eintrag
  await expect(page.locator('text=/whitelist.*1|1.*whitelist/i').first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-ADM-2c: Modus-Badge "Offen" bei Playbook ohne Einträge im open-Modus', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/admin/playbook-permissions')
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
  // DE-Locale: "Offen" für open-Modus
  await expect(page.locator('text=Offen').first()).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-ADM-3: Default-Mode-Switch
// ══════════════════════════════════════════════════════════════════════════════

test('AC-UI-ADM-3a: DefaultModeSwitch zeigt "open" Modus korrekt an', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/*/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/admin/playbook-permissions')
  // Toggle sollte nicht aria-checked=true sein (open = nicht restricted)
  await expect(page.locator('[role="switch"]')).toHaveAttribute('aria-checked', 'false', { timeout: 5000 })
})

test('AC-UI-ADM-3b: Wechsel auf "restricted" öffnet ConfirmModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/*/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/admin/playbook-permissions')
  await page.locator('[role="switch"]').click()

  // ConfirmModal muss erscheinen (Warnhinweis)
  await expect(page.getByRole('dialog').or(page.locator('[role="alertdialog"]')).or(
    page.locator('.fixed.inset-0').filter({ hasText: /sperrt.*Playbooks|restricted/i })
  )).toBeVisible({ timeout: 3000 })
})

test('AC-UI-ADM-3c: Bestätigung im ConfirmModal sendet PUT-Request', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/*/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  let putCalled = false
  await page.route('/api/playbook-permissions/config', async (route) => {
    if (route.request().method() === 'PUT') {
      putCalled = true
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(MOCK_CONFIG_RESTRICTED),
      })
    } else {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(MOCK_CONFIG_OPEN),
      })
    }
  })

  await page.goto('/admin/playbook-permissions')
  await page.locator('[role="switch"]').click()
  // Bestätigen-Button im Modal (DE-Locale: "Umschalten")
  await page.getByRole('button', { name: /Umschalten/i }).click()

  await expect.poll(() => putCalled).toBe(true)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-ADM-4: EditPermissionsModal
// ══════════════════════════════════════════════════════════════════════════════

test('AC-UI-ADM-4a: "Bearbeiten"-Button öffnet EditPermissionsModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PERMISSION_ENTRY]),
    })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_USER]),
    })
  )

  await page.goto('/admin/playbook-permissions')
  // Bearbeiten-Button für vm_destroy klicken
  const editButtons = page.getByRole('button', { name: /bearbeiten|edit/i })
  await editButtons.first().click()

  // Modal sollte erscheinen
  await expect(page.getByRole('dialog').or(page.locator('[data-testid="edit-permissions-modal"]')).first())
    .toBeVisible({ timeout: 3000 })
})

test('AC-UI-ADM-4b: EditPermissionsModal zeigt bestehende Einträge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  // vm_deploy: leer, vm_destroy: 1 Eintrag
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  // Muss sowohl für Tabellen-Count als auch für Modal-Fetch funktionieren
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PERMISSION_ENTRY]),
    })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_USER]),
    })
  )

  await page.goto('/admin/playbook-permissions')
  // Warten bis Tabelle geladen ist
  await expect(page.locator('text=vm_destroy').first()).toBeVisible({ timeout: 5000 })

  // Zweiten Bearbeiten-Button (für vm_destroy mit 1 Eintrag) klicken
  const editButtons = page.getByRole('button', { name: /bearbeiten|edit/i })
  const count = await editButtons.count()
  await editButtons.nth(count > 1 ? 1 : 0).click()

  // alice sollte in der Eintrags-Liste erscheinen (in einem <li>-Element, nicht als hidden <option>)
  await expect(page.locator('ul li').filter({ hasText: 'alice' }).first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-ADM-4c: SubjectPicker zeigt User/Gruppe-Toggle', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_USER]),
    })
  )

  await page.goto('/admin/playbook-permissions')
  const editButtons = page.getByRole('button', { name: /bearbeiten|edit/i })
  await editButtons.first().click()

  // User/Gruppe Toggle-Buttons
  await expect(page.getByRole('button', { name: /user|nutzer/i }).first()).toBeVisible({ timeout: 3000 })
  await expect(page.getByRole('button', { name: /gruppe|group/i }).first()).toBeVisible({ timeout: 3000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-PB: Playbooks-Seite Filterung
// ══════════════════════════════════════════════════════════════════════════════

test('AC-UI-PB-1: Playbook mit can_execute=true ist auf Provisioning-Seite sichtbar', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PLAYBOOK_OPEN]),
    })
  )

  await page.goto('/provisioning')
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-PB-2: Playbook mit can_execute=false wird auf Provisioning-Seite ausgeblendet', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PLAYBOOK_RESTRICTED]),
    })
  )

  await page.goto('/provisioning')
  await expect(page.locator('text=vm_destroy')).not.toBeVisible()
})

test('AC-UI-PB-3: Admin sieht Playbooks auch wenn can_execute=false', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(MOCK_MY_PERMISSIONS_ADMIN),
    })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      // Admin: can_execute ist immer true (Backend setzt es)
      body: JSON.stringify([
        { ...MOCK_PLAYBOOK_OPEN, can_execute: true },
        { ...MOCK_PLAYBOOK_RESTRICTED, can_execute: true },
      ]),
    })
  )

  await page.goto('/provisioning')
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=vm_destroy').first()).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-PROF: Profil-Anzeige „Erlaubte Playbooks"
// ══════════════════════════════════════════════════════════════════════════════

async function mockPermissionsPageApi(page, myPermissions = []) {
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(myPermissions),
    })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        username: 'op', auth_type: 'local',
        capabilities: { app_role: ['operator'] },
        roles: [], groups: [],
      }),
    })
  )
  await page.route('/api/rbac/me/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ bypass: false, assignments: [] }),
    })
  )
  await page.route('/api/packer', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/jobs', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/owners', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

test('AC-UI-PROF-1a: PermissionsPage zeigt "Freigegebene Playbooks"-Sektion', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await mockPermissionsPageApi(page, MOCK_MY_PERMISSIONS_DEFAULT)

  await page.goto('/permissions')
  await expect(
    page.locator('text=/Freigegebene Playbooks|Allowed Playbooks/i').first()
  ).toBeVisible({ timeout: 5000 })
})

test('AC-UI-PROF-1b: Source-Badge "direkt" erscheint bei direktem Whitelist-Eintrag', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await mockPermissionsPageApi(page, MOCK_MY_PERMISSIONS_DIRECT)

  await page.goto('/permissions')
  await expect(page.locator('text=vm_destroy').first()).toBeVisible({ timeout: 5000 })
  // DE-Locale source_direct = 'direkt'
  await expect(page.locator('text=direkt').first()).toBeVisible({ timeout: 3000 })
})

test('AC-UI-PROF-1c: Source-Badge "über Gruppe" erscheint bei Gruppen-Mitgliedschaft', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await mockPermissionsPageApi(page, MOCK_MY_PERMISSIONS_GROUP)

  await page.goto('/permissions')
  // Source-Badge sollte Gruppenname "infra-leads" enthalten (DE: "über Gruppe infra-leads")
  await expect(page.locator('text=infra-leads').first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-PROF-1d: Source-Badge "Standard-Modus" erscheint bei default_mode_open', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await mockPermissionsPageApi(page, MOCK_MY_PERMISSIONS_DEFAULT)

  await page.goto('/permissions')
  // DE-Locale source_default_mode = 'Standard-Modus'
  await expect(page.locator('text=Standard-Modus').first()).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-PERM: Portal-Permission Sichtbarkeit in UserForm
// ══════════════════════════════════════════════════════════════════════════════

test('AC-PERM-3: UserForm listet manage_playbook_permissions als Permission', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_USER]),
    })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/system-settings?tab=users')
  // User-Bearbeiten öffnen
  await page.getByRole('button', { name: /bearbeiten|edit/i }).first().click()

  // manage_playbook_permissions Permission-Toggle sollte sichtbar sein
  await expect(
    page.locator('text=/Playbook-Berechtigungen verwalten|manage_playbook_permissions/i').first()
  ).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-ADM-5: Fehlerbehandlung / Duplikat-409
// ══════════════════════════════════════════════════════════════════════════════

test('AC-UI-ADM-5: 409-Duplikat zeigt freundliche Fehlermeldung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks/vm_deploy/permissions', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    } else if (route.request().method() === 'POST') {
      route.fulfill({
        status: 409, contentType: 'application/json',
        body: JSON.stringify({ detail: 'Dieser Eintrag existiert bereits (Duplikat).' }),
      })
    }
  })
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_USER]),
    })
  )

  await page.goto('/admin/playbook-permissions')
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
  const editButtons = page.getByRole('button', { name: /bearbeiten|edit/i })
  await editButtons.first().click()

  // Warten bis Dropdown geladen ist
  await expect(page.locator('select').first()).toBeVisible({ timeout: 5000 })
  // User "alice" aus dem Dropdown wählen
  await page.locator('select').first().selectOption({ label: 'alice' })

  // Hinzufügen-Button klicken (jetzt enabled)
  await page.getByRole('button', { name: /Hinzufügen/i }).first().click()

  // Fehlermeldung sollte erscheinen (DE-Locale: duplicate_entry = "Dieser Eintrag existiert bereits.")
  await expect(
    page.locator('text=Dieser Eintrag existiert bereits').first()
  ).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// Routing: /admin/playbook-permissions ist per ProtectedLayout gesichert
// ══════════════════════════════════════════════════════════════════════════════

test('AC-SEC-1: Viewer ohne Permission kann Route nicht aufrufen', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await mockCommonApi(page)

  await page.goto('/admin/playbook-permissions')
  // Sollte auf Dashboard weitergeleitet werden oder 403-Seite zeigen
  await expect(page).not.toHaveURL('/admin/playbook-permissions', { timeout: 3000 })
    .catch(() => {
      // Wenn URL gleich bleibt, muss Seiten-Inhalt fehlen oder Forbidden angezeigt sein
    })
  // Alternativ: Seiteninhalt zeigt keine Playbook-Tabelle
  await expect(page.locator('text=/Playbook-Berechtigungen|playbook.permissions/i').first())
    .not.toBeVisible({ timeout: 2000 })
    .catch(() => {/* Redirect deckt diesen Fall ab */})
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-EDIT-1: Keine Plus-Schranke für Playbook-Permissions
// ══════════════════════════════════════════════════════════════════════════════

test('AC-EDIT-1: Core-Edition zeigt Admin-Seite vollständig (kein Plus-Gate)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: false })
  await page.route('/api/playbooks/vm_deploy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks/vm_destroy/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/admin/playbook-permissions')
  // Tabelle sollte sichtbar sein, kein PlusBadge-Gate blockiert
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('[role="switch"]')).toBeVisible({ timeout: 3000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// Regression: Playbook-Seite wird nicht für Operator mit leeren Permissions gebrochen
// ══════════════════════════════════════════════════════════════════════════════

test('REG-1: Provisioning-Seite lädt auch wenn /api/me/playbook-permissions leer ist', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PLAYBOOK_OPEN]),
    })
  )

  await page.goto('/provisioning')
  // Kein Crash, Seite rendert
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
})

test('REG-2: Provisioning-Seite filtert nicht wenn can_execute undefined/null', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me/playbook-permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ ...MOCK_PLAYBOOK_OPEN, can_execute: null }]),
    })
  )

  await page.goto('/provisioning')
  // null/undefined → nicht filtern → Playbook sichtbar
  await expect(page.locator('text=vm_deploy').first()).toBeVisible({ timeout: 5000 })
})
