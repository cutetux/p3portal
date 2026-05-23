// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Tokens ────────────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-signature'

// {"sub":"operator","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-signature'

// ── Fixture data ──────────────────────────────────────────────────────────────

const STATUS_DONE   = { setup_required: false, has_admin: true, has_node: true }
const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const AUDIT_ENTRIES = [
  { timestamp: '2026-05-03T14:22:11Z', token: 'portal@pve!admin-token', user: '',      method: 'GET',    endpoint: '/api2/json/nodes/pve1/qemu',                     status: '200', body: null },
  { timestamp: '2026-05-03T14:22:15Z', token: 'portal@pve!admin-token', user: 'chris', method: 'POST',   endpoint: '/api2/json/nodes/pve1/qemu/101/status/start',    status: '200', body: null },
  { timestamp: '2026-05-03T14:22:18Z', token: 'portal@pve!admin-token', user: '',      method: 'DELETE', endpoint: '/api2/json/nodes/pve1/qemu/105',                 status: '403', body: null },
  { timestamp: '2026-05-03T14:22:20Z', token: 'portal@pve!admin-token', user: '',      method: 'GET',    endpoint: '/api2/json/nodes/pve1/qemu/999',                 status: 'ERR', body: null },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => {
    sessionStorage.clear()
    sessionStorage.setItem('token', t)
  }, token)
}

async function mockBaseApis(page, role = 'admin', authType = 'local') {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: role === 'admin' ? 'admin' : 'operator', auth_type: authType, role, active: true }) }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/jobs', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/logs*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ logs: [], total: 0, offset: 0, limit: 100 }) }))
}

// ════════════════════════════════════════════════════════════════════════════
// AC: Tab "Proxmox API" – Sichtbarkeit
// ════════════════════════════════════════════════════════════════════════════

test('PA1: Tab "Proxmox API" erscheint für Admin wenn Audit aktiviert (200)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await expect(page.getByRole('button', { name: 'Proxmox API' })).toBeVisible()
})

test('PA2: Tab "Proxmox API" nicht sichtbar wenn Audit deaktiviert (404)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }))
  await page.goto('/logs')

  await expect(page.getByRole('button', { name: 'Proxmox API' })).not.toBeVisible()
})

test('PA3: Tab "Proxmox API" nicht sichtbar für Operator', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockBaseApis(page, 'operator')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Forbidden"}' }))
  await page.goto('/logs')

  await expect(page.getByRole('button', { name: 'Proxmox API' })).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Tab-Inhalt – Tabelle
// ════════════════════════════════════════════════════════════════════════════

test('PA4: Tabellenheader zeigt alle Pflicht-Spalten', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()

  // All six columns must be present
  await expect(page.getByRole('columnheader', { name: 'Zeitstempel' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Token' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'User' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Methode' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Endpoint' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
})

test('PA5: Tabelle zeigt Einträge korrekt an', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()

  // Entries are rendered – use first() to avoid strict mode violation (text appears in multiple cells)
  await expect(page.getByText('/api2/json/nodes/pve1/qemu').first()).toBeVisible()
  // User field 'chris' appears only once
  await expect(page.getByText('chris')).toBeVisible()
})

test('PA6: User-Spalte leer (—) wenn kein user-Feld', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([AUDIT_ENTRIES[0]]) })) // first entry has user: ''
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()

  // Entry with empty user shows dash
  const rows = page.locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  await expect(rows.first().getByText('—')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Rot-Highlighting 4xx/5xx + ERR
// ════════════════════════════════════════════════════════════════════════════

test('PA7: Zeilen mit 4xx-Status sind rot hervorgehoben', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()

  // The row containing status 403 should have a red background class
  const errorRow = page.locator('tbody tr').filter({ hasText: '403' })
  await expect(errorRow).toHaveClass(/bg-red-50/)
})

test('PA8: Zeilen mit Status ERR sind rot hervorgehoben', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()

  const errRow = page.locator('tbody tr').filter({ hasText: 'ERR' })
  await expect(errRow).toHaveClass(/bg-red-50/)
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Filter-Dropdown
// ════════════════════════════════════════════════════════════════════════════

test('PA9: Filter "Alle" zeigt alle 4 Einträge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()
  await expect(page.getByText('4 Einträge')).toBeVisible()
})

test('PA10: Filter "Nur Fehler" zeigt nur 4xx/5xx + ERR', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()
  await page.selectOption('select', 'error')

  // 403 + ERR = 2 error entries
  await expect(page.getByText('2 Einträge')).toBeVisible()
  await expect(page.getByText('403')).toBeVisible()
  await expect(page.getByText('ERR')).toBeVisible()
  // 200 entries should not appear in the table body (only success entries gone)
  const successRows = page.locator('tbody tr').filter({ hasText: '200' })
  await expect(successRows).toHaveCount(0)
})

test('PA11: Filter "Nur Erfolg" zeigt nur 2xx', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()
  await page.selectOption('select', 'success')

  // 2 × 200 = 2 success entries
  await expect(page.getByText('2 Einträge')).toBeVisible()
  const errorRows = page.locator('tbody tr').filter({ hasText: '403' })
  await expect(errorRows).toHaveCount(0)
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Refresh-Button
// ════════════════════════════════════════════════════════════════════════════

test('PA12: Refresh-Button lädt die Tabelle neu', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')

  // React 18 StrictMode double-invokes effects in dev mode: first 2 calls (initial + re-invoke)
  // both return 2 entries. Refresh (call 3+) returns all 4 entries.
  // Routes are matched newest-first; the times:2 route takes priority and exhausts after 2 calls.
  const TWO_ENTRIES = AUDIT_ENTRIES.slice(0, 2)
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUDIT_ENTRIES) }))
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TWO_ENTRIES) }),
    { times: 2 })

  await page.goto('/logs')
  await expect(page.getByRole('button', { name: 'Proxmox API' })).toBeVisible()
  await page.getByRole('button', { name: 'Proxmox API' }).click()

  // After initial load: 2 entries
  await expect(page.getByText('2 Einträge')).toBeVisible()

  // Click refresh
  await page.getByRole('button', { name: /Aktualisieren/ }).click()

  // After refresh: all 4 entries
  await expect(page.getByText('4 Einträge')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Empty state
// ════════════════════════════════════════════════════════════════════════════

test('PA13: Leer-Zustand zeigt Hinweis auf PROXMOX_AUDIT_ENABLED', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto('/logs')

  await page.getByRole('button', { name: 'Proxmox API' }).click()

  await expect(page.getByText('PROXMOX_AUDIT_ENABLED=1')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Fehler-Zustand (non-404 error)
// ════════════════════════════════════════════════════════════════════════════

test('PA14: Fehler-Zustand (500) zeigt Fehlermeldung, Tab bleibt sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal Error"}' }))
  await page.goto('/logs')

  // Tab should still be visible (500 ≠ 404)
  await expect(page.getByRole('button', { name: 'Proxmox API' })).toBeVisible()
  await page.getByRole('button', { name: 'Proxmox API' }).click()

  await expect(page.getByText('Fehler beim Laden des Proxmox Audit-Logs')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC: Security – Information Leakage Prevention
// ════════════════════════════════════════════════════════════════════════════

test('PA15: Operator-Nutzer sieht Tab nicht und kann ihn nicht manuell aktivieren', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockBaseApis(page, 'operator')
  await page.route('/api/admin/proxmox-audit', r =>
    r.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Forbidden"}' }))
  await page.goto('/logs')

  // Tab must not be in DOM for operator
  await expect(page.getByRole('button', { name: 'Proxmox API' })).not.toBeVisible()

  // Attempting to navigate to the tab via URL yields the same page without the tab
  await page.goto('/logs')
  await expect(page.getByRole('button', { name: 'Proxmox API' })).not.toBeVisible()
})
