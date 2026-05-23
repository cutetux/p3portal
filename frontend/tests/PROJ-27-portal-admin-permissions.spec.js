// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Payloads sind Base64-kodierte JWTs ohne echte Signatur (useAuth.parseJwtPayload
// liest nur den Payload-Teil). Generiert mit Python base64.b64encode(json.dumps(...)).

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"co_admin","auth_type":"local","role":"operator","portal_permissions":["manage_users"],"exp":9999999999}
const MANAGE_USERS_TOKEN =
  H + '.' +
  'eyJzdWIiOiJjb19hZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV91c2VycyJdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// {"sub":"node_mgr","auth_type":"local","role":"viewer","portal_permissions":["manage_nodes"],"exp":9999999999}
const MANAGE_NODES_TOKEN =
  H + '.' +
  'eyJzdWIiOiJub2RlX21nciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6InZpZXdlciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6WyJtYW5hZ2Vfbm9kZXMiXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"settings_mgr","auth_type":"local","role":"viewer","portal_permissions":["manage_settings"],"exp":9999999999}
const MANAGE_SETTINGS_TOKEN =
  H + '.' +
  'eyJzdWIiOiJzZXR0aW5nc19tZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOlsibWFuYWdlX3NldHRpbmdzIl0sImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-signature'

// {"sub":"apikey_mgr","auth_type":"local","role":"operator","portal_permissions":["manage_api_keys"],"exp":9999999999}
const MANAGE_API_KEYS_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhcGlrZXlfbWdyIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoib3BlcmF0b3IiLCJwb3J0YWxfcGVybWlzc2lvbnMiOlsibWFuYWdlX2FwaV9rZXlzIl0sImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-signature'

// {"sub":"multi_mgr","auth_type":"local","role":"operator","portal_permissions":["manage_users","manage_nodes"],"exp":9999999999}
const MULTI_PERM_TOKEN =
  H + '.' +
  'eyJzdWIiOiJtdWx0aV9tZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6WyJtYW5hZ2VfdXNlcnMiLCJtYW5hZ2Vfbm9kZXMiXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"plain_op","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const NO_PERM_OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwbGFpbl9vcCIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_USERS = [
  { id: 1, username: 'admin', role: 'admin', active: true, portal_permissions: [], created_at: '2026-05-04T00:00:00Z' },
  { id: 2, username: 'helpdesk', role: 'operator', active: true, portal_permissions: ['manage_users'], created_at: '2026-05-04T00:00:00Z' },
  { id: 3, username: 'readonly', role: 'viewer', active: true, portal_permissions: [], created_at: '2026-05-04T00:00:00Z' },
]

const MOCK_NODES = [
  { id: 1, name: 'pve01', host: '192.168.1.10', is_cluster: false, is_default: true },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommonApi(page) {
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }),
    })
  )
}

async function mockAdminUsers(page, users = MOCK_USERS) {
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(users),
    })
  )
}

async function mockAdminNodes(page) {
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_NODES),
    })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Sidebar-Sichtbarkeit: Admin sieht alle Links
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-1: Admin sieht alle 4 Admin-Links in der Sidebar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockAdminUsers(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Nutzerverwaltung')).toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).toBeVisible()
  await expect(page.locator('text=Administration')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Sidebar-Sichtbarkeit: Nutzer ohne Permissions sieht keinen Admin-Bereich
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-2: Operator ohne Permissions sieht keinen Admin-Bereich', async ({ page }) => {
  await setToken(page, NO_PERM_OPERATOR_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Administration')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/users"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Sidebar-Sichtbarkeit: manage_users → nur Nutzerverwaltung-Link
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-3: Operator mit manage_users sieht nur Nutzerverwaltungs-Link', async ({ page }) => {
  await setToken(page, MANAGE_USERS_TOKEN)
  await mockCommonApi(page)
  await mockAdminUsers(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Administration')).toBeVisible()
  await expect(page.locator('a[href="/admin/users"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Sidebar-Sichtbarkeit: manage_nodes → nur Nodes-Link
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-4: Viewer mit manage_nodes sieht nur Nodes-Link', async ({ page }) => {
  await setToken(page, MANAGE_NODES_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Administration')).toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/users"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Sidebar-Sichtbarkeit: manage_settings → nur Einstellungen-Link
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-5: Viewer mit manage_settings sieht nur Einstellungen-Link', async ({ page }) => {
  await setToken(page, MANAGE_SETTINGS_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Administration')).toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/users"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Sidebar-Sichtbarkeit: manage_api_keys → nur API-Keys-Link
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-6: Operator mit manage_api_keys sieht nur API-Keys-Link', async ({ page }) => {
  await setToken(page, MANAGE_API_KEYS_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Administration')).toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/users"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Sidebar-Sichtbarkeit: mehrere Permissions → mehrere Links
// ════════════════════════════════════════════════════════════════════════════

test('SIDEBAR-7: Operator mit manage_users + manage_nodes sieht beide Links', async ({ page }) => {
  await setToken(page, MULTI_PERM_TOKEN)
  await mockCommonApi(page)
  await mockAdminUsers(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Administration')).toBeVisible()
  await expect(page.locator('a[href="/admin/users"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/nodes"]')).toBeVisible()
  await expect(page.locator('a[href="/admin/settings"]')).not.toBeVisible()
  await expect(page.locator('a[href="/admin/api-keys"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 8. ProtectedRoute: manage_users erlaubt Zugriff auf /admin/users
// ════════════════════════════════════════════════════════════════════════════

test('PROT-1: Operator mit manage_users kann /admin/users aufrufen', async ({ page }) => {
  await setToken(page, MANAGE_USERS_TOKEN)
  await mockAdminUsers(page)
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/admin/users')
  await expect(page).not.toHaveURL(/\/dashboard/)
  await expect(page).toHaveURL(/\/admin\/users/)
})

// ════════════════════════════════════════════════════════════════════════════
// 9. ProtectedRoute: kein Permission-Match → Redirect zu /dashboard
// ════════════════════════════════════════════════════════════════════════════

test('PROT-2: Operator ohne manage_nodes wird von /admin/nodes zu /dashboard geleitet', async ({ page }) => {
  await setToken(page, NO_PERM_OPERATOR_TOKEN)
  await mockCommonApi(page)

  await page.goto('/admin/nodes')
  await expect(page).toHaveURL(/\/dashboard/)
})

test('PROT-3: Viewer ohne manage_settings wird von /admin/settings zu /dashboard geleitet', async ({ page }) => {
  await setToken(page, NO_PERM_OPERATOR_TOKEN)
  await mockCommonApi(page)

  await page.goto('/admin/settings')
  await expect(page).toHaveURL(/\/dashboard/)
})

test('PROT-4: Operator mit manage_nodes kann /admin/nodes aufrufen', async ({ page }) => {
  await setToken(page, MANAGE_NODES_TOKEN)
  await mockAdminNodes(page)
  await page.route('/api/setup/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ setup_done: true }),
    })
  )

  await page.goto('/admin/nodes')
  await expect(page).not.toHaveURL(/\/dashboard/)
  await expect(page).toHaveURL(/\/admin\/nodes/)
})

// ════════════════════════════════════════════════════════════════════════════
// 10. UserForm: PortalPermissionsSection erscheint nur für Nicht-Admin-Nutzer
// ════════════════════════════════════════════════════════════════════════════

test('FORM-1: Admin sieht PortalPermissionsSection im UserForm (nicht für Admin-Nutzer)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USERS),
    })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users/2/rbac-assignments', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users/2/api-key-settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }),
    })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: false }),
    })
  )

  await page.goto('/admin/users')

  // Bearbeiten-Button für den Operator-Nutzer (id=2) klicken
  const rows = page.locator('tr')
  const helpdeskRow = rows.filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button', { hasText: /[Bb]earbeiten|[Ee]dit/ }).first().click()

  // Portal-Berechtigungen-Sektion muss sichtbar sein (für operator)
  await expect(page.locator('text=Portal-Berechtigungen')).toBeVisible()

  // 5 Toggles müssen sichtbar sein
  await expect(page.locator('text=Nutzerverwaltung (Nutzer & Rollenpresets)')).toBeVisible()
  await expect(page.locator('text=Nodes verwalten')).toBeVisible()
  await expect(page.locator('text=Systemeinstellungen verwalten')).toBeVisible()
  await expect(page.locator('text=API-Keys verwalten')).toBeVisible()
  await expect(page.locator('text=Logs & Audit-Log einsehen')).toBeVisible()
})

test('FORM-2: Portal-Berechtigungen-Sektion fehlt für Admin-Nutzer im Edit-Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USERS),
    })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users/1/rbac-assignments', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users/1/api-key-settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }),
    })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: false }),
    })
  )

  await page.goto('/admin/users')

  // Bearbeiten-Button für den Admin-Nutzer (id=1) klicken
  const rows = page.locator('tr')
  const adminRow = rows.filter({ hasText: /^admin/ }).first()
  await adminRow.locator('button', { hasText: /[Bb]earbeiten|[Ee]dit/ }).first().click()

  // Portal-Berechtigungen-Sektion darf NICHT sichtbar sein für Admin-Nutzer
  await expect(page.locator('text=Portal-Berechtigungen')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 11. JWT-Hinweis im UserForm sichtbar
// ════════════════════════════════════════════════════════════════════════════

test('FORM-3: JWT-Hinweis erscheint in der Portal-Berechtigungen-Sektion', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USERS),
    })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users/2/rbac-assignments', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users/2/api-key-settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }),
    })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ valid: false }),
    })
  )

  await page.goto('/admin/users')

  const rows = page.locator('tr')
  const helpdeskRow = rows.filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button', { hasText: /[Bb]earbeiten|[Ee]dit/ }).first().click()

  await expect(page.locator('text=Änderungen wirken erst nach erneutem Login')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 12. Edge Case: Co-Admin mit manage_users wird von /admin/nodes zu /dashboard geleitet
// ════════════════════════════════════════════════════════════════════════════

test('EDGE-1: Co-Admin mit manage_users hat kein Zugriff auf /admin/nodes', async ({ page }) => {
  await setToken(page, MANAGE_USERS_TOKEN)
  await mockCommonApi(page)

  await page.goto('/admin/nodes')
  await expect(page).toHaveURL(/\/dashboard/)
})

test('EDGE-2: Co-Admin mit manage_users hat kein Zugriff auf /admin/api-keys', async ({ page }) => {
  await setToken(page, MANAGE_USERS_TOKEN)
  await mockCommonApi(page)

  await page.goto('/admin/api-keys')
  await expect(page).toHaveURL(/\/dashboard/)
})

// ════════════════════════════════════════════════════════════════════════════
// 13. Regression: Ohne Token → /login
// ════════════════════════════════════════════════════════════════════════════

test('REG-1: Direktaufruf /admin/users ohne Token leitet zu /login weiter', async ({ page }) => {
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login/)
})

test('REG-2: Direktaufruf /admin/nodes ohne Token leitet zu /login weiter', async ({ page }) => {
  await page.goto('/admin/nodes')
  await expect(page).toHaveURL(/\/login/)
})

test('REG-3: Direktaufruf /admin/api-keys ohne Token leitet zu /login weiter', async ({ page }) => {
  await page.goto('/admin/api-keys')
  await expect(page).toHaveURL(/\/login/)
})
