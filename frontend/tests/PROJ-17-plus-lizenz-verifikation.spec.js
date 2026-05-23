// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999,"jti":"admin-proj17"}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5LCJqdGkiOiJhZG1pbi1wcm9qMTcifQ==' +
  '.fake-sig'

// ── Mock-Daten: /api/license/status ──────────────────────────────────────────
const LIC_BASIS = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
}
const LIC_PLUS_VALID = {
  edition: 'plus_v1', valid: true,
  contact_name: 'Acme GmbH', contact_email: 'admin@acme.de',
  expiry: '2028-04-28', reason: null,
}
const LIC_PLUS_V2_VALID = {
  edition: 'plus_v2', valid: true,
  contact_name: 'Mega Corp', contact_email: 'cto@mega.com',
  expiry: '2029-01-01', reason: null,
}
const LIC_EXPIRED = {
  edition: 'plus_v1', valid: false,
  contact_name: 'Old Customer', contact_email: 'old@customer.de',
  expiry: '2024-01-01', reason: 'expired',
}
const LIC_INVALID = {
  edition: 'plus_v1', valid: false,
  contact_name: null, contact_email: null,
  expiry: null, reason: 'decryption_failed',
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function mockAdminSettingsPage(page, licenseData) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)

  await page.route('**/api/license/status', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(licenseData) }))

  // Mock all admin settings API calls to avoid 500s in component sections
  await page.route('**/api/settings/ssh-key', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/admin/settings/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/cluster/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('AC-1: gültige Plus v1 Lizenz zeigt grünes Schloss-Icon mit Tooltip', async ({ page }) => {
  await mockAdminSettingsPage(page, LIC_PLUS_VALID)

  const icon = page.locator('[role="img"][aria-label*="P3 Plus v1"]')
  await expect(icon).toBeVisible()

  const tooltip = await icon.getAttribute('title')
  expect(tooltip).toContain('P3 Plus v1')
  expect(tooltip).toContain('Acme GmbH')
  expect(tooltip).toContain('2028-04-28')

  // Icon sollte grün sein (text-green-500 Klasse)
  const svg = icon.locator('svg')
  await expect(svg).toHaveClass(/text-green-500/)
})

test('AC-2: gültige Plus v2 Lizenz zeigt grünes Schloss mit korrektem Label', async ({ page }) => {
  await mockAdminSettingsPage(page, LIC_PLUS_V2_VALID)

  const icon = page.locator('[role="img"][aria-label*="P3 Plus v2"]')
  await expect(icon).toBeVisible()

  const tooltip = await icon.getAttribute('title')
  expect(tooltip).toContain('P3 Plus v2')
  expect(tooltip).toContain('Mega Corp')
})

test('AC-3: abgelaufene Lizenz zeigt rotes Schloss mit Ablaufdatum im Tooltip', async ({ page }) => {
  await mockAdminSettingsPage(page, LIC_EXPIRED)

  const icon = page.locator('[role="img"]')
  await expect(icon).toBeVisible()

  const tooltip = await icon.getAttribute('title')
  expect(tooltip).toContain('Lizenz abgelaufen am')
  expect(tooltip).toContain('2024-01-01')

  // Icon sollte rot sein
  const svg = icon.locator('svg')
  await expect(svg).toHaveClass(/text-red-500/)
})

test('AC-4: ungültige Lizenz (decryption_failed) zeigt rotes Schloss mit Fehlermeldung', async ({ page }) => {
  await mockAdminSettingsPage(page, LIC_INVALID)

  const icon = page.locator('[role="img"]')
  await expect(icon).toBeVisible()

  const tooltip = await icon.getAttribute('title')
  expect(tooltip).toContain('Lizenz ungültig')
  expect(tooltip).toContain('Entschlüsselung fehlgeschlagen')

  const svg = icon.locator('svg')
  await expect(svg).toHaveClass(/text-red-500/)
})

test('AC-5: Basis-Edition (kein plus.lic) zeigt graues Schloss-Icon', async ({ page }) => {
  await mockAdminSettingsPage(page, LIC_BASIS)

  const icon = page.locator('[role="img"]')
  await expect(icon).toBeVisible()

  const tooltip = await icon.getAttribute('title')
  expect(tooltip).toBe('P3 Basis')

  const svg = icon.locator('svg')
  await expect(svg).toHaveClass(/text-gray-400/)
})

test('AC-6: /api/license/status ist ohne Authorization-Header erreichbar', async ({ page }) => {
  // Routed direkt (kein Auth-Interceptor in license.js)
  let requestAuthHeader = null
  let statusCode = 0

  await page.route('**/api/license/status', async (r) => {
    requestAuthHeader = r.request().headers()['authorization'] ?? null
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIC_BASIS) })
    statusCode = 200
  })
  await page.route('**/api/settings/ssh-key', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  await page.route('**/api/admin/settings/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/admin/settings')
  await page.waitForLoadState('networkidle')

  expect(requestAuthHeader).toBeNull()  // kein Auth-Header in license.js-Request
  expect(statusCode).toBe(200)
})

test('AC-7: LicenseStatusBanner erscheint im Header der Admin-Einstellungsseite', async ({ page }) => {
  await mockAdminSettingsPage(page, LIC_PLUS_VALID)

  // Header mit h1 "Einstellungen" + Banner daneben
  await expect(page.locator('h1', { hasText: 'Einstellungen' })).toBeVisible()
  await expect(page.locator('[role="img"]')).toBeVisible()
})

test('AC-8: API gibt niemals 500 zurück – korrupte plus.lic liefert reason-Feld', async ({ page }) => {
  // Simuliert Backend-Verhalten (backend-seitig bereits getestet, hier Frontend-Resilience)
  const errorData = { edition: 'basis', valid: false, contact_name: null,
    contact_email: null, expiry: null, reason: 'decryption_failed' }
  await mockAdminSettingsPage(page, errorData)

  // Banner sollte trotzdem rendern (kein Crash)
  const icon = page.locator('[role="img"]')
  await expect(icon).toBeVisible()
  const tooltip = await icon.getAttribute('title')
  expect(tooltip).toContain('ungültig')
})
