// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Admin-Token ───────────────────────────────────────────────────────────
// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_USERS_3 = [
  { id: 1, username: 'admin',    role: 'admin',    active: true, created_at: '2026-04-30T00:00:00Z' },
  { id: 2, username: 'operator', role: 'operator', active: true, created_at: '2026-04-30T00:00:00Z' },
  { id: 3, username: 'viewer',   role: 'viewer',   active: true, created_at: '2026-04-30T00:00:00Z' },
]

const MOCK_USERS_6 = [
  ...MOCK_USERS_3,
  { id: 4, username: 'user4', role: 'operator', active: true, created_at: '2026-04-30T00:00:00Z' },
  { id: 5, username: 'user5', role: 'viewer',   active: true, created_at: '2026-04-30T00:00:00Z' },
  { id: 6, username: 'user6', role: 'operator', active: true, created_at: '2026-04-30T00:00:00Z' },
]

const MOCK_PRESETS_2 = [
  { id: 1, name: 'Read-Only',  description: '', permissions: ['view'],  assignment_count: 0, created_at: '2026-04-30T00:00:00Z', created_by: 'admin' },
  { id: 2, name: 'Operator',   description: '', permissions: ['start'], assignment_count: 1, created_at: '2026-04-30T00:00:00Z', created_by: 'admin' },
]

const MOCK_PRESETS_5 = [
  ...MOCK_PRESETS_2,
  { id: 3, name: 'P3', description: '', permissions: ['stop'],      assignment_count: 0, created_at: '2026-04-30T00:00:00Z', created_by: 'admin' },
  { id: 4, name: 'P4', description: '', permissions: ['reboot'],    assignment_count: 0, created_at: '2026-04-30T00:00:00Z', created_by: 'admin' },
  { id: 5, name: 'P5', description: '', permissions: ['configure'], assignment_count: 0, created_at: '2026-04-30T00:00:00Z', created_by: 'admin' },
]

function basisLimits(userCurrent, presetCurrent) {
  return {
    edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing',
    limits: {
      users:   { current: userCurrent,   max: 6, unlimited: false },
      presets: { current: presetCurrent, max: 5, unlimited: false },
    },
  }
}

function plusLimits(userCurrent, presetCurrent) {
  return {
    edition: 'plus_v1', valid: true, contact_name: 'Test', contact_email: 'test@example.com', expiry: '2099-01-01', reason: null,
    limits: {
      users:   { current: userCurrent,   max: null, unlimited: true },
      presets: { current: presetCurrent, max: null, unlimited: true },
    },
  }
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function mockCommon(page) {
  await page.route('/api/playbooks', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }),
  }))
}

async function mockUsers(page, users) {
  await page.route('/api/admin/users', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users) }))
}

async function mockPresets(page, presets) {
  await page.route('/api/rbac/presets', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(presets) }))
  await page.route('/api/rbac/users/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockLicense(page, licenseData) {
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(licenseData) }))
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Basis Edition – Benutzer-Badge
// ════════════════════════════════════════════════════════════════════════════

test('B1: Basis Edition zeigt Benutzer-Badge mit aktuellem Zählerstand', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockLicense(page, basisLimits(3, 0))

  await page.goto('/admin/users')
  await expect(page.locator('text=3 / 6 Benutzer')).toBeVisible()
})

test('B2: Basis Edition Badge rot wenn Limit erreicht', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_6)
  await mockLicense(page, basisLimits(6, 0))

  await page.goto('/admin/users')
  const badge = page.locator('text=6 / 6 Benutzer')
  await expect(badge).toBeVisible()
  // Badge hat rote Farbe wenn atLimit
  await expect(badge).toHaveClass(/text-red/)
})

test('B3: Basis Edition Button aktiv wenn unter Limit', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockLicense(page, basisLimits(3, 0))

  await page.goto('/admin/users')
  const btn = page.locator('button:has-text("Nutzer anlegen")')
  await expect(btn).toBeVisible()
  await expect(btn).not.toBeDisabled()
})

test('B4: Basis Edition Button disabled wenn Limit erreicht', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_6)
  await mockLicense(page, basisLimits(6, 0))

  await page.goto('/admin/users')
  const btn = page.locator('button:has-text("Nutzer anlegen")')
  await expect(btn).toBeDisabled()
})

test('B5: Basis Edition Tooltip bei deaktiviertem Benutzer-Button sichtbar', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_6)
  await mockLicense(page, basisLimits(6, 0))

  await page.goto('/admin/users')
  const btn = page.locator('button:has-text("Nutzer anlegen")')
  await btn.hover()
  await expect(page.locator('text=Limit erreicht – Upgrade auf P3 Plus')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Basis Edition – Preset-Badge
// ════════════════════════════════════════════════════════════════════════════

test('B6: Basis Edition zeigt Preset-Badge mit aktuellem Zählerstand', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_2)
  await mockLicense(page, basisLimits(3, 2))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  await expect(page.locator('text=2 / 5 Presets')).toBeVisible()
})

test('B7: Basis Edition Preset-Badge rot wenn Limit erreicht', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_5)
  await mockLicense(page, basisLimits(3, 5))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  const badge = page.locator('text=5 / 5 Presets')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveClass(/text-red/)
})

test('B8: Basis Edition Preset-Button aktiv wenn unter Limit', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_2)
  await mockLicense(page, basisLimits(3, 2))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  const btn = page.locator('button:has-text("Preset anlegen")')
  await expect(btn).toBeVisible()
  await expect(btn).not.toBeDisabled()
})

test('B9: Basis Edition Preset-Button disabled wenn Limit erreicht', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_5)
  await mockLicense(page, basisLimits(3, 5))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  const btn = page.locator('button:has-text("Preset anlegen")')
  await expect(btn).toBeDisabled()
})

test('B10: Basis Edition Tooltip bei deaktiviertem Preset-Button sichtbar', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_5)
  await mockLicense(page, basisLimits(3, 5))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  const btn = page.locator('button:has-text("Preset anlegen")')
  await btn.hover()
  await expect(page.locator('text=Limit erreicht – Upgrade auf P3 Plus')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Plus Edition – kein Badge, keine Sperre
// ════════════════════════════════════════════════════════════════════════════

test('P1: Plus Edition zeigt keinen Benutzer-Badge', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_6)
  await mockLicense(page, plusLimits(6, 5))

  await page.goto('/admin/users')
  await expect(page.locator('text=/ 6 Benutzer')).not.toBeVisible()
})

test('P2: Plus Edition Benutzer-Button auch bei hoher Anzahl nicht disabled', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_6)
  await mockLicense(page, plusLimits(6, 5))

  await page.goto('/admin/users')
  const btn = page.locator('button:has-text("Nutzer anlegen")')
  await expect(btn).not.toBeDisabled()
})

test('P3: Plus Edition zeigt keinen Preset-Badge', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_5)
  await mockLicense(page, plusLimits(3, 5))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  await expect(page.locator('text=/ 5 Presets')).not.toBeVisible()
})

test('P4: Plus Edition Preset-Button auch bei 5 Presets nicht disabled', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockUsers(page, MOCK_USERS_3)
  await mockPresets(page, MOCK_PRESETS_5)
  await mockLicense(page, plusLimits(3, 5))

  await page.goto('/admin/users')
  await page.locator('button:has-text("Rollenpresets")').click()
  const btn = page.locator('button:has-text("Preset anlegen")')
  await expect(btn).not.toBeDisabled()
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Backend-Enforcement: 403-Response erzeugt Fehlermeldung im UI
// ════════════════════════════════════════════════════════════════════════════

test('E1: POST /api/admin/users mit 403 zeigt Fehlermeldung im Formular', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  // Benutzer unter Limit → Button aktiv
  await mockUsers(page, MOCK_USERS_3)
  await mockLicense(page, basisLimits(3, 0))

  // Aber POST liefert 403 (Race Condition simulieren)
  await page.route('/api/admin/users', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Basis Edition: Maximale Benutzeranzahl (6) erreicht. Upgrade auf P3 Plus für unbegrenzte Benutzer.' }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS_3) })
    }
  })

  await page.goto('/admin/users')
  await page.locator('button:has-text("Nutzer anlegen")').click()

  // Formular füllen (username + password + passwordConfirm)
  await page.locator('input[name="username"]').fill('newuser')
  await page.locator('input[name="password"]').fill('Password123!')
  await page.locator('input[name="passwordConfirm"]').fill('Password123!')
  await page.locator('button[type="submit"]').click()

  // Fehlermeldung sichtbar
  await expect(page.locator('text=Basis Edition')).toBeVisible()
})
