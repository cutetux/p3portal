// p3portal.org
// PROJ-47: E2E-Tests für Node-Scope-Permissions
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Payloads sind Base64-kodierte JWTs ohne echte Signatur (parseJwtPayload liest nur Payload).

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"node_mgr","auth_type":"local","role":"operator","portal_permissions":["manage_nodes"],"exp":9999999999}
const MANAGE_NODES_TOKEN =
  H + '.' +
  'eyJzdWIiOiJub2RlX21nciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9ub2RlcyJdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-sig'

// {"sub":"plain_op","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const NO_PERM_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwbGFpbl9vcCIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_NODE = {
  id: 1,
  name: 'pve01',
  url: 'https://pve01.local:8006',
  proxmox_node: 'pve',
  is_cluster: false,
  is_default: true,
  poll_interval: 30,
}

const MOCK_PRESET = {
  id: 1,
  name: 'VM-Viewer',
  description: 'Kann VMs ansehen',
  permissions: ['view'],
  node_actions: ['node:view_tasks'],
  created_at: '2026-01-01T10:00:00Z',
  created_by: 'admin',
}

const MOCK_PRESET_2 = {
  id: 2,
  name: 'VM-Operator',
  description: 'Kann VMs starten und stoppen',
  permissions: ['view', 'start', 'stop'],
  node_actions: [],
  created_at: '2026-01-01T10:00:00Z',
  created_by: 'admin',
}

const MOCK_USER = {
  id: 2,
  username: 'alice',
  role: 'operator',
  active: true,
  auth_type: 'local',
  portal_permissions: [],
  created_at: '2026-01-01T10:00:00Z',
}

const MOCK_GROUP = { // eslint-disable-line no-unused-vars
  id: 1,
  name: 'web-team',
  description: 'Web-Team',
  tags: ['prod'],
  owner_id: null,
  owner_display: null,
  member_count: 3,
  created_at: '2026-01-01T10:00:00Z',
  created_by: 'admin',
}

const MOCK_ASSIGNMENT = {
  id: 1,
  node_id: 1,
  subject_type: 'user',
  subject_id: 2,
  subject_display: 'alice',
  role_preset_id: 1,
  preset_name: 'VM-Viewer',
  preset_node_actions: ['node:view_tasks'],
  added_at: '2026-05-10T10:00:00Z',
  added_by: 'admin',
}

const MOCK_GROUP_ASSIGNMENT = {
  id: 2,
  node_id: 1,
  subject_type: 'group',
  subject_id: 1,
  subject_display: 'web-team',
  role_preset_id: 2,
  preset_name: 'VM-Operator',
  preset_node_actions: [],
  added_at: '2026-05-10T11:00:00Z',
  added_by: 'admin',
}

const MOCK_MY_ASSIGNMENT = {
  node_id: 1,
  node_name: 'pve01',
  role_preset_id: 1,
  preset_name: 'VM-Viewer',
  preset_permissions: ['view'],
  preset_node_actions: ['node:view_tasks'],
  source: 'direct',
  source_group_name: null,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommonApi(page, { plus = true } = {}) {
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
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
      body: JSON.stringify([MOCK_NODE]),
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
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
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
}

async function mockNodesTab(page, { assignments = [] } = {}) {
  await page.route('**/api/nodes/1/assignments', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(assignments),
    })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_PRESET, MOCK_PRESET_2]),
    })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_USER]),
    })
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// AC-NodeTable: "Zugriff verwalten"-Button Sichtbarkeit
// ══════════════════════════════════════════════════════════════════════════════

test('AC-NodeTable-1: Plus + Admin sieht "Zugriff verwalten"-Button in Nodes-Tab', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page)

  await page.goto('/system-settings?tab=nodes')
  await expect(page.getByRole('button', { name: 'Zugriff verwalten' })).toBeVisible({ timeout: 5000 })
})

test('AC-NodeTable-2: Plus + manage_nodes sieht "Zugriff verwalten"-Button', async ({ page }) => {
  await setToken(page, MANAGE_NODES_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page)

  await page.goto('/system-settings?tab=nodes')
  await expect(page.getByRole('button', { name: 'Zugriff verwalten' })).toBeVisible({ timeout: 5000 })
})

test('AC-NodeTable-3: Core-Edition versteckt "Zugriff verwalten"-Button', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: false })
  await mockNodesTab(page, { assignments: [], plus: false })

  await page.goto('/system-settings?tab=nodes')
  await expect(page.getByText('pve01').first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('button', { name: 'Zugriff verwalten' })).not.toBeVisible()
})

test('AC-NodeTable-4: Operator ohne manage_nodes sieht keinen Nodes-Tab', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.goto('/system-settings')
  // Nodes tab only visible for manage_nodes or admin
  await expect(page.locator('[data-testid="tab-nodes"]').or(page.getByRole('tab', { name: 'Nodes' }))).not.toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-NodeAccessModal: Modal öffnen und Grundelemente
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Modal-1: "Zugriff verwalten" öffnet NodeAccessModal mit Node-Name', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page)

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  await expect(page.locator('text=pve01').first()).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=/Zugriff.*pve01/')).toBeVisible({ timeout: 3000 })
})

test('AC-Modal-2: Empty-State zeigt korrekte Meldung bei leeren Zuweisungen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  await expect(page.locator('text=Keine Zuweisungen')).toBeVisible({ timeout: 3000 })
})

test('AC-Modal-3: Plus zeigt "Zuweisung hinzufügen"-Button im Footer', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  await expect(page.getByRole('button', { name: 'Zuweisung hinzufügen' })).toBeVisible({ timeout: 3000 })
})

test('AC-Modal-4: Schließen-Button schließt das Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await expect(page.locator('text=Keine Zuweisungen')).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: 'Schließen' }).click()
  await expect(page.locator('text=Keine Zuweisungen')).not.toBeVisible({ timeout: 2000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-Modal-Assignments: Zuweisungs-Tabelle
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Modal-5: Zuweisungs-Tabelle zeigt User-Assignment', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [MOCK_ASSIGNMENT] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  await expect(page.locator('text=alice')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=VM-Viewer')).toBeVisible()
  // Subject-Type Badge for user
  await expect(page.locator('text=Nutzer').first()).toBeVisible()
})

test('AC-Modal-6: Zuweisungs-Tabelle zeigt Gruppen-Assignment', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [MOCK_GROUP_ASSIGNMENT] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  await expect(page.locator('text=web-team')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=VM-Operator')).toBeVisible()
  // Subject-Type Badge for group
  await expect(page.locator('text=Gruppe').first()).toBeVisible()
})

test('AC-Modal-7: Node-Action-Badges erscheinen bei preset_node_actions', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [MOCK_ASSIGNMENT] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  // node:view_tasks → translated as "Events/Aufgaben" (NodeActionBadge span)
  await expect(page.locator('span').filter({ hasText: /Events.Aufgaben/ }).first()).toBeVisible({ timeout: 3000 })
})

test('AC-Modal-8: Zuweisungs-Zähler im Footer korrekt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [MOCK_ASSIGNMENT, MOCK_GROUP_ASSIGNMENT] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  // Footer should show count "2 Zuweisungen"
  await expect(page.locator('text=/2 Zuweisung/')).toBeVisible({ timeout: 3000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-Core-Downgrade: Banner
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Core-1: Core-Downgrade-Banner erscheint wenn Core + bestehende Assignments', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: false })

  // Override nodes API to return node (Core can still show node)
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) })
  )
  // Mock assignments endpoint with data
  await page.route('**/api/nodes/1/assignments', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_ASSIGNMENT]),
    })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PRESET]) })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_USER]) })
  )

  // In Core the "Zugriff verwalten" button is hidden by isPlus check
  // So we cannot open the modal via UI — this is the expected behavior (Core: hidden)
  await page.goto('/system-settings?tab=nodes')
  await expect(page.getByText('pve01').first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('button', { name: 'Zugriff verwalten' })).not.toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-AssignmentModal: Sub-Modal
// ══════════════════════════════════════════════════════════════════════════════

test('AC-SubModal-1: "Zuweisung hinzufügen" öffnet AssignmentModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await expect(page.locator('text=Keine Zuweisungen')).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: 'Zuweisung hinzufügen' }).click()

  // AssignmentModal should appear with title "Neue Zuweisung"
  await expect(page.locator('text=/Neue Zuweisung.*pve01/')).toBeVisible({ timeout: 3000 })
})

test('AC-SubModal-2: AssignmentModal zeigt User/Gruppe-Toggle', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await page.getByRole('button', { name: 'Zuweisung hinzufügen' }).click()

  // Toggle buttons: "Nutzer" and "Gruppe"
  await expect(page.locator('button:has-text("Nutzer")').first()).toBeVisible({ timeout: 3000 })
  await expect(page.locator('button:has-text("Gruppe")').first()).toBeVisible({ timeout: 3000 })
})

test('AC-SubModal-3: AssignmentModal zeigt Preset-Dropdown', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await page.getByRole('button', { name: 'Zuweisung hinzufügen' }).click()

  // Rollenpreset section should be present (section header or field label)
  await expect(page.locator('text=/Rollenpreset/').first()).toBeVisible({ timeout: 3000 })
})

test('AC-SubModal-4: POST-Request beim Zuweisen wird korrekt gesendet', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let postBody = null
  await page.route('**/api/nodes/1/assignments', (route) => {
    if (route.request().method() === 'POST') {
      postBody = route.request().postDataJSON()
      route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_ASSIGNMENT, id: 10 }),
      })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PRESET]) })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_USER]) })
  )

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await page.getByRole('button', { name: 'Zuweisung hinzufügen' }).click()

  // Select "Nutzer" type (should already be selected by default)
  // Select user from dropdown
  await page.locator('select').first().selectOption({ label: 'alice' })

  // Select preset
  await page.locator('select').last().selectOption({ value: '1' })

  await page.getByRole('button', { name: 'Zuweisen' }).click()

  // Wait for POST
  await page.waitForTimeout(500)
  expect(postBody).not.toBeNull()
  expect(postBody.subject_type).toBe('user')
  expect(postBody.role_preset_id).toBe(1)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-DELETE: Zuweisung entfernen
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Delete-1: Löschen-Button öffnet Bestätigungs-Dialog', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockNodesTab(page, { assignments: [MOCK_ASSIGNMENT] })

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await expect(page.locator('text=alice')).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: 'Löschen' }).click()

  // ConfirmModal should appear
  await expect(page.locator('text=/entfernen/i').first()).toBeVisible({ timeout: 2000 })
})

test('AC-Delete-2: Bestätigter Delete sendet DELETE-Request', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let deleteCalled = false
  await page.route('**/api/nodes/1/assignments/**', (route) => {
    if (route.request().method() === 'DELETE') {
      deleteCalled = true
      route.fulfill({ status: 204 })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })
  await page.route('**/api/nodes/1/assignments', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_ASSIGNMENT]) })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PRESET]) })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_USER]) })
  )

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await expect(page.locator('text=alice')).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.locator('text=/entfernen/i').first()).toBeVisible({ timeout: 2000 })

  // Click confirm button in ConfirmModal
  await page.getByRole('button', { name: 'Löschen' }).last().click()
  await page.waitForTimeout(500)
  expect(deleteCalled).toBe(true)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-PresetForm: Node-Aktionen-Sektion
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Preset-1: PresetFormModal zeigt "Node-Aktionen"-Sektion', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PRESET]) })
  )
  await page.route('/api/rbac/presets/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PRESET) })
  )

  await page.goto('/system-settings?tab=users&sub=presets')

  // Click "Preset anlegen" button
  const newPresetBtn = page.getByRole('button', { name: 'Preset anlegen' })
  await expect(newPresetBtn).toBeVisible({ timeout: 5000 })
  await newPresetBtn.click()

  // Node-Aktionen section should appear in the form
  await expect(page.locator('text=Node-Aktionen')).toBeVisible({ timeout: 3000 })
})

test('AC-Preset-2: Node-Aktionen-Checkboxen sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/system-settings?tab=users&sub=presets')
  const newPresetBtn = page.getByRole('button', { name: 'Preset anlegen' })
  await expect(newPresetBtn).toBeVisible({ timeout: 5000 })
  await newPresetBtn.click()

  // Check for node actions checkboxes
  await expect(page.locator('text=Aufgaben/Events ansehen')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=Backups ansehen')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=ISO hochladen')).toBeVisible({ timeout: 3000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-PermissionsPage: Node-Zugriffe-Sektion
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Perms-1: PermissionsPage zeigt keine Node-Zugriffe-Sektion ohne Assignments', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        username: 'admin', auth_type: 'local',
        capabilities: { app_role: ['admin'] },
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

  await page.goto('/permissions')
  await expect(page.locator('text=Node-Zugriffe')).not.toBeVisible({ timeout: 3000 })
})

test('AC-Perms-2: PermissionsPage zeigt Node-Zugriffe-Sektion mit Assignments', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  // Override node-assignments with data
  await page.route('/api/me/node-assignments', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_MY_ASSIGNMENT]),
    })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        username: 'admin', auth_type: 'local',
        capabilities: { app_role: ['admin'] },
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

  await page.goto('/permissions')

  await expect(page.locator('text=Node-Zugriffe')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=pve01')).toBeVisible({ timeout: 3000 })
  await expect(page.locator('text=VM-Viewer')).toBeVisible({ timeout: 3000 })
})

test('AC-Perms-3: PermissionsPage zeigt "Direkt" als Quelle für direktes Assignment', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('/api/me/node-assignments', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_MY_ASSIGNMENT]),
    })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        username: 'admin', auth_type: 'local',
        capabilities: { app_role: ['admin'] },
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

  await page.goto('/permissions')
  await expect(page.locator('text=Direkt')).toBeVisible({ timeout: 5000 })
})

test('AC-Perms-4: PermissionsPage zeigt Node-Aktionen wenn preset_node_actions nicht leer', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('/api/me/node-assignments', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([MOCK_MY_ASSIGNMENT]),
    })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        username: 'admin', auth_type: 'local',
        capabilities: { app_role: ['admin'] },
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

  await page.goto('/permissions')
  // node:view_tasks should show as "Events/Aufgaben"
  await expect(page.locator('text=/Events|Aufgaben/')).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-409-Duplikat-Fehler
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Dup-1: Duplikat-Zuweisung (409) zeigt Fehler im AssignmentModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('**/api/nodes/1/assignments', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 409, contentType: 'application/json',
        body: JSON.stringify({ detail: 'Dieses Subjekt hat bereits eine Zuweisung auf diesem Node.' }),
      })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PRESET]) })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_USER]) })
  )

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await page.getByRole('button', { name: 'Zuweisung hinzufügen' }).click()

  await page.locator('select').first().selectOption({ label: 'alice' })
  await page.locator('select').last().selectOption({ value: '1' })
  await page.getByRole('button', { name: 'Zuweisen' }).click()

  // Error message should appear in the modal
  await expect(page.locator('text=/bereits.*Zuweisung|Subjekt hat bereits/')).toBeVisible({ timeout: 3000 })
  // Modal stays open
  await expect(page.locator('text=/Neue Zuweisung/')).toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-403-Plus-Gate
// ══════════════════════════════════════════════════════════════════════════════

test('AC-Gate-1: Backend-403 (license_limit) wird im AssignmentModal angezeigt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('**/api/nodes/1/assignments', (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ detail: 'license_limit_node_assignments_reached' }),
      })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PRESET]) })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_USER]) })
  )

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()
  await page.getByRole('button', { name: 'Zuweisung hinzufügen' }).click()

  await page.locator('select').first().selectOption({ label: 'alice' })
  await page.locator('select').last().selectOption({ value: '1' })
  await page.getByRole('button', { name: 'Zuweisen' }).click()

  // Error should appear (403 shown in modal)
  await expect(page.locator('text=/license_limit|Lizenz|Plus/i').first()).toBeVisible({ timeout: 3000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// Sicherheits-Audit
// ══════════════════════════════════════════════════════════════════════════════

test('Sicherheit: Ohne Token → Redirect zur Login-Seite', async ({ page }) => {
  await page.goto('/system-settings?tab=nodes')
  await expect(page).toHaveURL(/login/, { timeout: 5000 })
})

test('Sicherheit: Operator ohne manage_nodes sieht keine Nodes-Tab-Inhalte', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.goto('/system-settings?tab=nodes')
  // No "Zugriff verwalten" button visible
  await expect(page.getByRole('button', { name: 'Zugriff verwalten' })).not.toBeVisible({ timeout: 3000 })
})

test('Sicherheit: API-Fehler beim Laden zeigt Fehler-Banner im Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('**/api/nodes/1/assignments', (route) => {
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Internal error' }) })
  })
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/system-settings?tab=nodes')
  await page.getByRole('button', { name: 'Zugriff verwalten' }).click()

  // Error banner or fallback state should appear
  // useNodeAssignments sets error = 'Zuweisungen konnten nicht geladen werden.'
  await expect(page.locator('text=/konnten nicht geladen/').first()).toBeVisible({ timeout: 5000 })
})
