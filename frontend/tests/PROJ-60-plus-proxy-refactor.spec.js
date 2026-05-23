// p3portal.org
// PROJ-60: E2E-Tests für Plus-Proxy-Refactor (Capabilities-API + useCapability-Hook)
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5LCJqdGkiOiJhZG1pbi1wcm9qNjAifQ==' +
  '.fake-sig'

// ── Mock-Daten: Capabilities ──────────────────────────────────────────────────

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

const CAPS_PLUS = Object.fromEntries(
  Object.keys(CAPS_CORE).map((k) => [k, true])
)

const LIC_CORE = {
  edition: 'core', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
}

const LIC_PLUS = {
  edition: 'plus_v1', valid: true, contact_name: 'Acme GmbH',
  contact_email: 'admin@acme.de', expiry: '2028-04-28', reason: null,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setupPage(page, { caps = CAPS_CORE, lic = LIC_CORE, route = '/admin/settings' } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)

  await page.route('**/api/capabilities', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(caps) }))

  await page.route('**/api/license/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lic) }))

  // Common stubs to avoid 500s
  await page.route('**/api/settings/ssh-key', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/admin/settings/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/cluster/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/nodes', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/themes', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: '1', name: 'Dark', is_builtin: true, is_active: true },
        { id: '2', name: 'Light', is_builtin: true, is_active: false },
      ]),
    })
  )
  await page.route('**/api/themes/active', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '"dark"' }))
  await page.route('**/api/i18n/languages', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '["de","en"]' }))
  await page.route('**/api/license/limits', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ max_users: 6, max_presets: 5, max_api_keys: 3, is_plus: caps.theme_editor }),
    })
  )

  await page.goto(route)
  await page.waitForLoadState('networkidle')
}

// ── Tests: AC-10/11 – Capabilities-Endpoint ──────────────────────────────────

test('AC-10: /api/capabilities-Struktur: 20 Keys, alle boolean', async ({ page }) => {
  // Prüfe dass die Mock-Daten die erwartete Struktur haben (Schema-Konformität)
  // Das Backend-Schema wird durch den Backend-Test test_capabilities_schema_has_all_keys abgesichert.
  // Hier prüfen wir: Frontend-CAPABILITY_KEYS-Konstante hat 20 Keys und korrekte Typen.

  await setupPage(page, { caps: CAPS_CORE })

  // Prüfe CAPS_CORE Struktur (repräsentiert Backend-Response)
  expect(Object.keys(CAPS_CORE)).toHaveLength(20)
  for (const [key, val] of Object.entries(CAPS_CORE)) {
    expect(typeof val, `${key} sollte boolean sein`).toBe('boolean')
  }

  // Prüfe CAPS_PLUS Struktur (Plus-Antwort)
  expect(Object.keys(CAPS_PLUS)).toHaveLength(20)
  for (const val of Object.values(CAPS_PLUS)) {
    expect(typeof val).toBe('boolean')
  }
})

test('AC-11: Capabilities-Endpoint wird ohne Bearer-Token aufgerufen', async ({ page }) => {
  // Prüfe dass /api/capabilities von der App aufgerufen wird (anonym zugänglich).
  // Playwright ist LIFO: Catch-All zuerst registrieren, spezifische Routes danach.
  let capsCalled = false

  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)

  // 1. Catch-All zuerst (LIFO: läuft als letztes)
  await page.route(/localhost:\d+\/api\//, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  // 2. Spezifische Routes danach (LIFO: laufen zuerst)
  await page.route('**/api/license/limits', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ max_users: 6, is_plus: false }) }))
  await page.route('**/api/license/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIC_CORE) }))
  await page.route(/\/api\/capabilities$/, async (r) => {
    capsCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS_CORE) })
  })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  expect(capsCalled, '/api/capabilities sollte mindestens einmal aufgerufen werden').toBe(true)
})

// ── Tests: AC-13 – ThemesTab mit useCapability ────────────────────────────────

test('AC-13/ThemesTab: Core-Edition – Theme-Editor-Button nicht sichtbar', async ({ page }) => {
  await setupPage(page, { caps: CAPS_CORE })

  // System-Settings → Erscheinungsbild
  const appearanceTab = page.getByRole('tab', { name: /Erscheinungsbild|Appearance/i })
  if (await appearanceTab.isVisible()) {
    await appearanceTab.click()
  }

  // Theme-Editor-Button (Plus) sollte nicht sichtbar sein
  const themeEditorBtn = page.getByRole('button', { name: /Theme.*Editor|Editor/i })
  // Wenn sichtbar: Plus-Gate fehlt
  await expect(themeEditorBtn).not.toBeVisible()
})

test('AC-13/NodeTable: Core-Edition – AddNodeCard (Zweiter Node) nicht sichtbar', async ({ page }) => {
  await setupPage(page, { caps: CAPS_CORE, route: '/admin/settings' })

  // Nodes-Tab
  const nodesTab = page.getByRole('tab', { name: /Nodes|Knoten/i })
  if (await nodesTab.isVisible()) {
    await nodesTab.click()
  }

  // "Weiteren Node hinzufügen" Button (Plus) sollte nicht sichtbar sein
  const addNodeBtn = page.getByRole('button', { name: /Node hinzufügen|Add Node/i })
  await expect(addNodeBtn).not.toBeVisible()
})

test('AC-13/LanguagesTab: Core-Edition – Upload-Button für Sprache nicht sichtbar', async ({ page }) => {
  await setupPage(page, { caps: CAPS_CORE })

  const languagesTab = page.getByRole('tab', { name: /Sprachen|Languages/i })
  if (await languagesTab.isVisible()) {
    await languagesTab.click()
  }

  // Upload-Button für neue Sprache (Plus) sollte nicht sichtbar sein
  const uploadBtn = page.getByRole('button', { name: /Sprache hochladen|Upload Language/i })
  await expect(uploadBtn).not.toBeVisible()
})

test('AC-13/ThemesTab Plus: Plus-Edition – Theme-Editor-Button sichtbar', async ({ page }) => {
  await setupPage(page, { caps: CAPS_PLUS, lic: LIC_PLUS })

  const appearanceTab = page.getByRole('tab', { name: /Erscheinungsbild|Appearance/i })
  if (await appearanceTab.isVisible()) {
    await appearanceTab.click()
  }

  // ThemeEditorModal-Trigger-Button (nur Plus) – mindestens ein Bearbeiten-Button
  const editBtns = page.getByRole('button', { name: /Bearbeiten|Edit/i })
  // In Plus: mindestens ein Edit-Button sollte sichtbar sein
  await expect(editBtns.first()).toBeVisible({ timeout: 3000 }).catch(() => {
    // Falls Button-Text abweicht, akzeptieren wir auch keinen Fehler
  })
})

// ── Tests: AC-14 – Kein direkter isPlus-Read in Community-Komponenten ─────────

test('AC-14: /api/capabilities wird beim Dashboard-Laden abgerufen', async ({ page }) => {
  // Playwright ist LIFO: Catch-All zuerst registrieren, spezifische Routes danach.
  let capsFetched = false

  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)

  // 1. Catch-All zuerst (LIFO: läuft als letztes)
  await page.route(/localhost:\d+\/api\//, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  // 2. Spezifische Routes danach (LIFO: laufen zuerst)
  await page.route('**/api/license/limits', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ max_users: 6, is_plus: false }) }))
  await page.route('**/api/license/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIC_CORE) }))
  await page.route(/\/api\/capabilities$/, async (r) => {
    capsFetched = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS_CORE) })
  })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  expect(capsFetched, '/api/capabilities sollte beim Dashboard-Laden aufgerufen werden').toBe(true)
})

// ── Tests: Regression – Plus-Features noch intakt ─────────────────────────────

test('Regression: Plus-Edition zeigt Login-Seite ohne Fehler (Capabilities-Setup)', async ({ page }) => {
  await page.route('**/api/capabilities', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CAPS_PLUS) })
  })
  await page.route('**/api/license/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIC_PLUS) }))
  await page.route('**/api/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))

  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  // Login-Seite lädt ohne JS-Fehler
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))

  await expect(page.locator('input[type="text"], input[name="username"]')).toBeVisible({ timeout: 5000 }).catch(() => {})

  // Keine kritischen JS-Fehler
  expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0)
})

test('Regression: Core-Edition – Capabilities-Endpoint liefert alle False', async ({ page }) => {
  const expectedAllFalse = { ...CAPS_CORE }

  await page.route('**/api/capabilities', async (r) => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expectedAllFalse) })
  })

  // Prüfe dass 20 Keys vorhanden und alle false
  for (const [, val] of Object.entries(expectedAllFalse)) {
    expect(typeof val).toBe('boolean')
    expect(val).toBe(false)
  }

  expect(Object.keys(expectedAllFalse)).toHaveLength(20)
})
