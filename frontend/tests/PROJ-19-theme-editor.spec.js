// p3portal.org
import { test, expect } from '@playwright/test'

// ── Token-Fixtures ─────────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999,"jti":"admin-proj19"}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5LCJqdGkiOiJhZG1pbi1wcm9qMTkifQ==' +
  '.fake-sig'

// ── Mock-Daten ─────────────────────────────────────────────────────────────────
const BUILTIN_THEMES = [
  { id: 'dark', name: 'Dark', is_builtin: true, vars: { '--accent': '#f97316', '--bg': '#09090b', '--bg2': '#27272a', '--bg3': '#3f3f46', '--sidebar': '#18181b', '--red': '#ef4444' } },
  { id: 'p3orange', name: 'P3 Orange', is_builtin: true, vars: { '--accent': '#e07b39', '--bg': '#1e2028', '--bg2': '#23262f', '--bg3': '#2a2d38', '--sidebar': '#16181e', '--red': '#c0392b' } },
]

const THEMES_WITH_CUSTOM = [
  ...BUILTIN_THEMES,
  {
    id: 'corp-blue',
    name: 'Corporate Blue',
    is_builtin: false,
    vars: { '--accent': '#0080ff', '--bg': '#001f3f', '--bg2': '#002d5a', '--bg3': '#003875', '--sidebar': '#001020', '--red': '#ff3333' },
  },
]

const LIC_BASIS = { edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing' }
const LIC_PLUS  = { edition: 'plus_v1', valid: true, contact_name: 'Acme GmbH', contact_email: 'admin@acme.de', expiry: '2028-01-01', reason: null }

// ── Helpers ────────────────────────────────────────────────────────────────────
async function mockAdminSettings(page, { licenseData = LIC_BASIS, themes = BUILTIN_THEMES } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)

  await page.route('**/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(licenseData) }))
  await page.route('**/api/themes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(themes) }))
  await page.route('**/api/themes/default', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme_id: 'dark' }) }))
  await page.route('**/api/i18n/languages', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ code: 'de', name: 'Deutsch', is_builtin: true }]) }))
  await page.route('**/api/i18n/default', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lang_code: 'de' }) }))
  await page.route('**/api/settings/ssh-key', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/admin/settings/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/settings/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test('AC-19-1: Basis-Nutzer sieht Schloss-Icon statt aktiven Erstellen-Button', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_BASIS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  // Plus-Gate: Schloss-Icon sichtbar, kein aktiver Button
  const lockSpan = page.locator('span[title]').filter({ hasText: 'Neues Theme' })
  await expect(lockSpan).toBeVisible()

  // Kein aktiver Button zum Erstellen
  const createBtn = page.locator('button', { hasText: 'Neues Theme' })
  await expect(createBtn).not.toBeVisible()
})

test('AC-19-2: Plus-Nutzer sieht aktiven "Neues Theme"-Button', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('button', { hasText: 'Neues Theme' })).toBeVisible()
})

test('AC-19-3: Klick auf "Neues Theme" öffnet Editor-Modal', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: 'Neues Theme' }).click()

  // Modal-Titel sichtbar
  await expect(page.locator('text=Neues Theme erstellen')).toBeVisible()
})

test('AC-19-4: Modal im Color-Picker-Modus zeigt Farbwähler und Radius-Schieberegler', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  // Farbwähler vorhanden
  const colorInputs = page.locator('input[type="color"]')
  await expect(colorInputs.first()).toBeVisible()
  const count = await colorInputs.count()
  expect(count).toBeGreaterThanOrEqual(16)

  // Radius-Schieberegler vorhanden
  const rangeInputs = page.locator('input[type="range"]')
  await expect(rangeInputs.first()).toBeVisible()
  const rangeCount = await rangeInputs.count()
  expect(rangeCount).toBe(2)
})

test('AC-19-5: Name-Pflichtfeld – Speichern-Button deaktiviert ohne Namen', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  const saveBtn = page.locator('button', { hasText: 'Speichern' })
  await expect(saveBtn).toBeDisabled()
})

test('AC-19-6: Speichern-Button aktiv nach Name-Eingabe', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await page.locator('input[type="text"]').fill('Mein Theme')
  const saveBtn = page.locator('button', { hasText: 'Speichern' })
  await expect(saveBtn).toBeEnabled()
})

test('AC-19-7: JSON-Modus wechseln zeigt Textarea mit gültigem JSON', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await page.locator('button', { hasText: 'JSON' }).click()

  const textarea = page.locator('textarea')
  await expect(textarea).toBeVisible()
  const jsonText = await textarea.inputValue()
  expect(() => JSON.parse(jsonText)).not.toThrow()
  const parsed = JSON.parse(jsonText)
  expect(parsed).toHaveProperty('--accent')
})

test('AC-19-8: Ungültiges JSON in Raw-JSON-Modus: Speichern-Button deaktiviert', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await page.locator('input[type="text"]').fill('Test Theme')
  await page.locator('button', { hasText: 'JSON' }).click()

  const textarea = page.locator('textarea')
  await textarea.fill('{invalid json')

  const saveBtn = page.locator('button', { hasText: 'Speichern' })
  await expect(saveBtn).toBeDisabled()
})

test('AC-19-9: Abbrechen schließt Modal', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await expect(page.locator('text=Neues Theme erstellen')).toBeVisible()

  await page.locator('button', { hasText: 'Abbrechen' }).click()

  await expect(page.locator('text=Neues Theme erstellen')).not.toBeVisible()
})

test('AC-19-10: ESC-Taste schließt Modal', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await expect(page.locator('text=Neues Theme erstellen')).toBeVisible()

  await page.keyboard.press('Escape')

  await expect(page.locator('text=Neues Theme erstellen')).not.toBeVisible()
})

test('AC-19-11: Neues Theme speichern ruft POST /api/themes auf', async ({ page }) => {
  let capturedRequest = null
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.route('**/api/themes', async (route, request) => {
    if (request.method() === 'POST') {
      capturedRequest = await request.postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-theme', name: 'Test Theme', is_builtin: false, vars: {} }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await page.locator('input[type="text"]').fill('Test Theme')
  await page.locator('button', { hasText: 'Speichern' }).click()

  await expect(page.locator('text=Neues Theme erstellen')).not.toBeVisible()
  expect(capturedRequest).not.toBeNull()
  expect(capturedRequest.name).toBe('Test Theme')
  expect(capturedRequest.variables).toBeDefined()
})

test('AC-19-12: Custom-Theme hat "Bearbeiten"-Button, Built-in nicht', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS, themes: THEMES_WITH_CUSTOM })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  // Custom-Theme hat Bearbeiten-Button
  const corpRow = page.locator('.flex.items-center.gap-3').filter({ hasText: 'Corporate Blue' })
  await expect(corpRow.locator('button', { hasText: 'Bearbeiten' })).toBeVisible()

  // Built-in Themes haben keinen Bearbeiten-Button
  const darkRow = page.locator('.flex.items-center.gap-3').filter({ hasText: 'Dark' }).first()
  await expect(darkRow.locator('button', { hasText: 'Bearbeiten' })).not.toBeVisible()
})

test('AC-19-13: Bearbeiten-Button öffnet Modal mit vorgeladenem Theme-Namen', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS, themes: THEMES_WITH_CUSTOM })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  const corpRow = page.locator('.flex.items-center.gap-3').filter({ hasText: 'Corporate Blue' })
  await corpRow.locator('button', { hasText: 'Bearbeiten' }).click()

  // Modal öffnet sich mit Edit-Titel
  await expect(page.locator('text=Theme bearbeiten')).toBeVisible()

  // Name ist vorgeladen
  const nameInput = page.locator('input[type="text"]')
  await expect(nameInput).toHaveValue('Corporate Blue')
})

test('AC-19-14: Bearbeiten ruft PUT /api/themes/{id} auf', async ({ page }) => {
  let putRequest = null
  await mockAdminSettings(page, { licenseData: LIC_PLUS, themes: THEMES_WITH_CUSTOM })
  await page.route('**/api/themes/corp-blue', async (route, request) => {
    if (request.method() === 'PUT') {
      putRequest = await request.postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'corp-blue', name: 'Corp Blue Updated', is_builtin: false, vars: {} }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  const corpRow = page.locator('.flex.items-center.gap-3').filter({ hasText: 'Corporate Blue' })
  await corpRow.locator('button', { hasText: 'Bearbeiten' }).click()

  const nameInput = page.locator('input[type="text"]')
  await nameInput.fill('Corp Blue Updated')
  await page.locator('button', { hasText: 'Speichern' }).click()

  await expect(page.locator('text=Theme bearbeiten')).not.toBeVisible()
  expect(putRequest).not.toBeNull()
  expect(putRequest.name).toBe('Corp Blue Updated')
})

test('AC-19-15: "Vorschau anwenden" im JSON-Modus funktioniert bei gültigem JSON', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await page.locator('button', { hasText: 'JSON' }).click()
  await expect(page.locator('button', { hasText: 'Vorschau anwenden' })).toBeVisible()
  await page.locator('button', { hasText: 'Vorschau anwenden' }).click()

  // Kein Fehler
  await expect(page.locator('text=Ungültiges JSON')).not.toBeVisible()
})

test('AC-19-16: Duplikate Name zeigt Fehlermeldung (409 Konflikt)', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.route('**/api/themes', async (route, request) => {
    if (request.method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Name bereits vergeben' }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  await page.locator('input[type="text"]').fill('Dark')
  await page.locator('button', { hasText: 'Speichern' }).click()

  await expect(page.locator('text=Name bereits vergeben')).toBeVisible()
})

test('AC-19-17: Radius-Schieberegler zeigen px-Wert', async ({ page }) => {
  await mockAdminSettings(page, { licenseData: LIC_PLUS })
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
  await page.locator('button', { hasText: 'Neues Theme' }).click()

  // Standardwerte 12px und 8px vorhanden
  await expect(page.locator('text=12px')).toBeVisible()
  await expect(page.locator('text=8px')).toBeVisible()
})
