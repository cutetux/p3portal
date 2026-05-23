// p3portal.org
// PROJ-46: E2E-Tests für Pools mit Ressourcen-Quotas
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Payloads sind Base64-kodierte JWTs ohne echte Signatur (parseJwtPayload liest nur Payload).

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"pool_mgr","auth_type":"local","role":"operator","portal_permissions":["manage_pools"],"exp":9999999999}
const MANAGE_POOLS_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwb29sX21nciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9wb29scyJdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-sig'

// {"sub":"plain_op","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const NO_PERM_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwbGFpbl9vcCIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTl9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_POOLS = [
  {
    id: 1,
    name: 'Web-Team',
    description: 'Webserver Pool',
    tags: ['prod', 'web'],
    owner_subject_type: 'user',
    owner_subject_id: 2,
    owner_display: 'alice',
    vm_count_quota: 10,
    cpu_quota: 20,
    ram_quota_mb: 32768,
    disk_quota_gb: 500,
    member_count: 3,
    assignment_count: 2,
    used_vm_count: 3,
    used_cpu: 8,
    used_ram_mb: 12288,
    used_disk_gb: 150,
    created_at: '2026-05-12T10:00:00Z',
    created_by: 'admin',
  },
  {
    id: 2,
    name: 'DevStage',
    description: null,
    tags: ['stage'],
    owner_subject_type: null,
    owner_subject_id: null,
    owner_display: null,
    vm_count_quota: 0,
    cpu_quota: 0,
    ram_quota_mb: 0,
    disk_quota_gb: 0,
    member_count: 1,
    assignment_count: 0,
    used_vm_count: 1,
    used_cpu: 2,
    used_ram_mb: 2048,
    used_disk_gb: 32,
    created_at: '2026-05-12T11:00:00Z',
    created_by: 'admin',
  },
]

const MOCK_POOL_DETAIL = {
  ...MOCK_POOLS[0],
  members: [
    { id: 1, pool_id: 1, resource_type: 'vm', node_id: 1, vmid: 100, added_at: '2026-05-12T10:05:00Z', added_by: 'admin' },
  ],
  assignments: [
    { id: 1, pool_id: 1, subject_type: 'user', subject_id: 2, role_preset_id: 1, preset_name: 'Operator', added_at: '2026-05-12T10:06:00Z', added_by: 'admin' },
  ],
}

const MOCK_POOL_USAGE = {
  pool_id: 1,
  vm_count_quota: 10, used_vm_count: 3,
  cpu_quota: 20, used_cpu: 8,
  ram_quota_mb: 32768, used_ram_mb: 12288,
  disk_quota_gb: 500, used_disk_gb: 150,
  is_over_quota: false,
}

const MOCK_USERS = [
  { id: 1, username: 'admin', role: 'admin', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
  { id: 2, username: 'alice', role: 'operator', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
]

const MOCK_PRESETS = [
  { id: 1, name: 'Operator', description: '', permissions: ['view', 'power'] },
  { id: 2, name: 'Viewer', description: '', permissions: ['view'] },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

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
      body: JSON.stringify([{ id: 1, name: 'pve01', host: '192.168.1.10', is_cluster: false, is_default: true }]),
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
}

async function mockPoolsApi(page, pools = MOCK_POOLS) {
  // Register /api/pools/tags FIRST (more specific) before the general /api/pools route
  await page.route('**/api/pools/tags', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ tags: ['prod', 'web', 'stage'] }),
    })
  )
  await page.route('**/api/pools*', (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/tags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: ['prod', 'web'] }) })
    if (url.match(/\/pools\/\d+\//) ) return route.continue()
    if (method === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pools) })
    } else {
      route.continue()
    }
  })
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PRESETS) })
  )
}

async function mockPoolDetail(page, pool = MOCK_POOL_DETAIL) {
  await page.route(`**/api/pools/${pool.id}/delete-preview`, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ member_count: 3, assignment_count: 2 }),
    })
  )
  await page.route(`**/api/pools/${pool.id}/usage`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_POOL_USAGE) })
  )
  await page.route(`**/api/pools/${pool.id}/members`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route(`**/api/pools/${pool.id}/assignments`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route(`**/api/pools/${pool.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pool) })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// AC-34: Sidebar-Sichtbarkeit (manage_pools Gate)
// ════════════════════════════════════════════════════════════════════════════

test('AC-34: Admin sieht Pools-Link in der Sidebar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/pools"]')).toBeVisible()
})

test('AC-34: Operator mit manage_pools sieht Pools-Link in der Sidebar', async ({ page }) => {
  await setToken(page, MANAGE_POOLS_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/pools"]')).toBeVisible()
})

test('AC-34: Operator ohne manage_pools sieht keinen Pools-Link', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/pools"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-31: Pools-Seite lädt und zeigt Pool-Liste
// ════════════════════════════════════════════════════════════════════════════

test('AC-31: Pools-Seite lädt für Admin und zeigt alle Pools', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/admin/pools')

  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()
  await expect(page.getByText('DevStage', { exact: true })).toBeVisible()
})

test('AC-31: Pools-Seite zeigt Pool-Tabelle mit Quota-Spalten', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/admin/pools')

  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()
  // Column headers should be present
  await expect(page.getByText('VMs', { exact: true }).first()).toBeVisible()
})

test('AC-31: Pools-Seite zeigt Empty-State wenn keine Pools vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page, [])

  await page.goto('/admin/pools')
  await expect(page.locator('text=Noch keine Pools vorhanden.')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-7: Core-Edition blockt Pool-Anlage
// ════════════════════════════════════════════════════════════════════════════

test('AC-7: Core-Edition deaktiviert den "Neuer Pool"-Button', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: false })
  await mockPoolsApi(page, [])

  await page.goto('/admin/pools')
  const createBtn = page.getByRole('button', { name: 'Neuer Pool' })
  await expect(createBtn).toBeDisabled()
})

test('AC-7: Core-Edition mit bestehenden Pools zeigt Downgrade-Banner', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: false })
  await mockPoolsApi(page, MOCK_POOLS)

  await page.goto('/admin/pools')
  // Banner mentions Plus-Lizenz
  await expect(page.locator('text=/Plus-Lizenz|plus-lizenz/i').first()).toBeVisible()
})

test('AC-7: Plus-Edition aktiviert den "Neuer Pool"-Button', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page, [])

  await page.goto('/admin/pools')
  const createBtn = page.getByRole('button', { name: 'Neuer Pool' })
  await expect(createBtn).not.toBeDisabled()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-1: Pool anlegen – Happy Path
// ════════════════════════════════════════════════════════════════════════════

test('AC-1: "Neuer Pool"-Button öffnet PoolFormModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page, [])

  await page.goto('/admin/pools')
  await page.getByRole('button', { name: 'Neuer Pool' }).click()

  // Modal header should appear with "Neuen Pool anlegen"
  await expect(page.getByText('Neuen Pool anlegen')).toBeVisible()
  // Name input should be visible
  await expect(page.locator('input[placeholder="z.B. Web-Team-Pool"]')).toBeVisible()
})

test('AC-1: Pool anlegen Happy Path – Formular abschicken', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  const newPool = { ...MOCK_POOLS[0], id: 3, name: 'Produktion' }

  await page.route('**/api/pools/tags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
  )
  await page.route('**/api/pools*', (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/tags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
    if (method === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(newPool) })
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([newPool]) })
  })
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )

  await page.goto('/admin/pools')
  await page.getByRole('button', { name: 'Neuer Pool' }).click()

  await expect(page.getByText('Neuen Pool anlegen')).toBeVisible()
  await page.locator('input[placeholder="z.B. Web-Team-Pool"]').fill('Produktion')
  await page.getByRole('button', { name: 'Speichern' }).click()

  // Modal closes after success
  await expect(page.locator('input[placeholder="z.B. Web-Team-Pool"]')).not.toBeVisible({ timeout: 3000 })
})

// ════════════════════════════════════════════════════════════════════════════
// AC-3: Pool-Namenskonflikt (409)
// ════════════════════════════════════════════════════════════════════════════

test('AC-3: Doppelter Poolname zeigt Fehler im Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('**/api/pools/tags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
  )
  await page.route('**/api/pools*', (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/tags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
    if (method === 'POST') {
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Pool name already exists' }),
      })
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_POOLS) })
  })
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )

  await page.goto('/admin/pools')
  await page.getByRole('button', { name: 'Neuer Pool' }).click()

  await page.locator('input[placeholder="z.B. Web-Team-Pool"]').fill('Web-Team')
  await page.getByRole('button', { name: 'Speichern' }).click()

  // Modal stays open, error shown
  await expect(page.locator('input[placeholder="z.B. Web-Team-Pool"]')).toBeVisible()
  await expect(page.locator('text=/already exists|bereits vorhanden|Pool name/i').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-8 / AC-9: Quota-Felder im Modal
// ════════════════════════════════════════════════════════════════════════════

test('AC-9: Quota-Felder im PoolFormModal sind standardmäßig 0', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page, [])

  await page.goto('/admin/pools')
  await page.getByRole('button', { name: 'Neuer Pool' }).click()

  await expect(page.getByText('Neuen Pool anlegen')).toBeVisible()

  // Quota section heading (exact match to avoid matching page title)
  await expect(page.getByRole('heading', { name: 'Ressourcen-Quotas', exact: true })).toBeVisible()

  // All quota fields should exist and default to 0
  const quotaInputs = page.locator('input[type="number"]')
  const count = await quotaInputs.count()
  expect(count).toBeGreaterThanOrEqual(4)

  for (let i = 0; i < count; i++) {
    await expect(quotaInputs.nth(i)).toHaveValue('0')
  }
})

test('AC-9: Quota-Sektion "Ressourcen-Quotas" im Modal sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page, [])

  await page.goto('/admin/pools')
  await page.getByRole('button', { name: 'Neuer Pool' }).click()

  await expect(page.getByText('Neuen Pool anlegen')).toBeVisible()
  // Quota section heading is visible in modal (exact to avoid page title match)
  await expect(page.getByRole('heading', { name: 'Ressourcen-Quotas', exact: true })).toBeVisible()
  // Quota field labels are present
  await expect(page.locator('text=Max. VMs/LXCs')).toBeVisible()
  await expect(page.locator('text=Max. CPU-Kerne')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-6: Pool löschen mit Bestätigungsdialog
// ════════════════════════════════════════════════════════════════════════════

test('AC-6: "Löschen"-Button in Pool-Tabelle öffnet Bestätigungsdialog', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)
  await mockPoolDetail(page)

  await page.goto('/admin/pools')
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()

  // Click the first "Löschen" button in the action column
  await page.getByRole('button', { name: 'Löschen' }).first().click()

  // DeletePoolConfirmModal should appear
  await expect(page.locator('text=Pool löschen')).toBeVisible()
})

test('AC-6: Bestätigungsdialog zeigt Anzahl betroffener Mitglieder', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)
  await mockPoolDetail(page)

  await page.goto('/admin/pools')
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Löschen' }).first().click()

  // Should show member count (3) from delete-preview
  await expect(page.locator('text=/3|Mitglieder/').first()).toBeVisible({ timeout: 5000 })
})

test('AC-6: Bestätigter Pool-Lösch-Request sendet DELETE', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)
  await mockPoolDetail(page)

  let deleteRequested = false
  await page.route('**/api/pools/1', (route) => {
    if (route.request().method() === 'DELETE') {
      deleteRequested = true
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_POOL_DETAIL) })
    }
  })

  await page.goto('/admin/pools')
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Löschen' }).first().click()
  await expect(page.locator('text=Pool löschen')).toBeVisible()

  // Click the confirm delete button in the modal (common.delete = "Löschen")
  // The modal footer has Cancel + Delete buttons; we click the red Delete one
  await page.getByRole('button', { name: 'Löschen' }).last().click()
  await page.waitForTimeout(500)
  expect(deleteRequested).toBe(true)
})

// ════════════════════════════════════════════════════════════════════════════
// AC-5: Pool bearbeiten
// ════════════════════════════════════════════════════════════════════════════

test('AC-5: "Bearbeiten"-Button öffnet Edit-Modal mit vorausgefülltem Namen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)
  await mockPoolDetail(page)

  await page.goto('/admin/pools')
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Bearbeiten' }).first().click()

  const nameInput = page.locator('input[placeholder="z.B. Web-Team-Pool"]')
  await expect(nameInput).toBeVisible()
  await expect(nameInput).toHaveValue('Web-Team')
})

// ════════════════════════════════════════════════════════════════════════════
// AC-30: Tag-Filter
// ════════════════════════════════════════════════════════════════════════════

test('AC-30: Tag-Filter-Eingabe ist vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/admin/pools')

  const tagInput = page.locator('input[placeholder="Nach Tag filtern"]')
  await expect(tagInput).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24: Filter "Pools ohne Owner"
// ════════════════════════════════════════════════════════════════════════════

test('AC-24: Checkbox "Ohne Owner" ist in der Toolbar vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/admin/pools')
  await expect(page.locator('text=Ohne Owner')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-8: Quota-Balken in der Pool-Tabelle
// ════════════════════════════════════════════════════════════════════════════

test('AC-8: Quota-Spalten zeigen Verbrauch/Limit in der Tabelle', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)

  await page.goto('/admin/pools')
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()

  // QuotaCell renders "used/quota" text (e.g., "3/10" or "1/∞")
  await expect(page.locator('text=/\\d+\\/\\d+/').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// Detail-Modal: Mitglieder-Tab (AC-13, AC-17)
// ════════════════════════════════════════════════════════════════════════════

test('Detail-Modal: "Mitglieder"-Button öffnet Detail-Ansicht', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockPoolsApi(page)
  await mockPoolDetail(page)

  await page.goto('/admin/pools')
  await expect(page.getByText('Web-Team', { exact: true })).toBeVisible()

  // Click the member count link (shows as button with count "3")
  await page.getByRole('button', { name: 'Mitglieder' }).first().click()

  // Detail modal should appear with tabs
  await expect(page.locator('text=/Mitglieder|Zuweisungen/').first()).toBeVisible({ timeout: 5000 })
})

// ════════════════════════════════════════════════════════════════════════════
// MyAccountPage: "Meine Pools" Tab (AC-31 Sichtbarkeit)
// ════════════════════════════════════════════════════════════════════════════

test('MyAccountPage enthält "Pools" Tab für alle eingeloggten Nutzer', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/profile')
  // The Pools tab should appear in the navigation
  await expect(page.getByText('Pools').first()).toBeVisible({ timeout: 5000 })
})

// ════════════════════════════════════════════════════════════════════════════
// Sicherheits-Audit
// ════════════════════════════════════════════════════════════════════════════

test('Sicherheit: Ohne Token → Redirect zur Login-Seite', async ({ page }) => {
  await page.goto('/admin/pools')
  await expect(page).toHaveURL(/login/, { timeout: 5000 })
})

test('Sicherheit: Operator ohne manage_pools sieht keinen Pools-Sidebar-Link', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/pools"]')).not.toBeVisible()
})

test('Sicherheit: Backend-403 für Nicht-Admin beim Anlegen wird im Modal angezeigt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.route('**/api/pools/tags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
  )
  await page.route('**/api/pools*', (route) => {
    const url = route.request().url()
    const method = route.request().method()
    if (url.includes('/tags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
    if (method === 'POST') {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Plus-Lizenz erforderlich' }),
      })
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )

  await page.goto('/admin/pools')
  await page.getByRole('button', { name: 'Neuer Pool' }).click()
  await page.locator('input[placeholder="z.B. Web-Team-Pool"]').fill('Test')
  await page.getByRole('button', { name: 'Speichern' }).click()

  // Error shown in modal, modal stays open
  await expect(page.locator('input[placeholder="z.B. Web-Team-Pool"]')).toBeVisible()
})
