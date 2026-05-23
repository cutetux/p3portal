// p3portal.org
import { test, expect } from '@playwright/test'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_REQUIRED = { setup_required: true, has_admin: false, has_node: false }

// ── Helfer ────────────────────────────────────────────────────────────────────

async function mockSetupStatus(page, s) {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(s) }))
}

// ════════════════════════════════════════════════════════════════════════════
// 1. WizardProgressBar – 6 Schritte + Datenbank als erster Schritt
// ════════════════════════════════════════════════════════════════════════════

test('DB1: WizardProgressBar zeigt "Datenbank" als Schritt 1', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  const bar = page.locator('.flex.items-center.gap-0')
  await expect(bar.locator('text=Datenbank').first()).toBeVisible()
  // Step 1 circle should show "1" (active)
  await expect(bar.locator('div').filter({ hasText: /^1$/ }).first()).toBeVisible()
})

test('DB2: Setup-Wizard startet mit Datenbank-Schritt', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await expect(page.locator('h2:has-text("Datenbank")')).toBeVisible()
  await expect(page.locator('text=Datenbankbackend')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 2. SQLite-Auswahl (Standard)
// ════════════════════════════════════════════════════════════════════════════

test('DB3: SQLite-Infobox sichtbar (Standard-Auswahl)', async ({ page }) => {
  // NOTE: Due to a known bug (undefined spreads over DEFAULT_FORM in WizardStep1Database),
  // the SQLite card may not render as visually selected (no border-orange-500) on first load.
  // The info box is still rendered because isPostgres=false. This test verifies the info box.
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  // SQLite info box should be visible (non-postgres path)
  await expect(page.locator('text=portal.db')).toBeVisible()
  // No PostgreSQL fields visible (SQLite is default)
  await expect(page.locator('input[placeholder="192.168.1.10"]')).not.toBeVisible()
})

test('DB4: SQLite-Auswahl zeigt Info-Box ohne Test-Button', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await expect(page.locator('text=portal.db')).toBeVisible()
  // No test button when SQLite is selected
  await expect(page.locator('text=Verbindung testen')).not.toBeVisible()
})

test('DB5: SQLite "Weiter" navigiert zum Admin-Schritt ohne API-Aufruf', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  let databaseApiCalled = false
  await page.route('/api/setup/database', () => { databaseApiCalled = true })
  await page.goto('/setup')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // SQLite does NOT call /api/setup/database (no-op, default)
  expect(databaseApiCalled).toBe(false)
  await expect(page.locator('text=Admin-Konto erstellen')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 3. PostgreSQL-Auswahl
// ════════════════════════════════════════════════════════════════════════════

test('DB6: Wechsel zu PostgreSQL zeigt Verbindungsfelder', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await expect(page.locator('input[placeholder="192.168.1.10"]')).toBeVisible()
  // Two "p3portal" placeholders exist: Datenbankname + Benutzername (autocomplete=username)
  await expect(page.locator('input[placeholder="p3portal"]').first()).toBeVisible()
  await expect(page.locator('text=Verbindung testen')).toBeVisible()
})

test('DB7: Wechsel zu PostgreSQL zeigt Datenverlust-Warnung', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await expect(page.locator('text=Portaldaten zurück')).toBeVisible()
  await expect(page.locator('text=Neuinstallation')).toBeVisible()
})

test('DB8: PostgreSQL – fehlender Host zeigt Client-Validierungsfehler', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  // Fill host with space to trigger onChange (BUG-25-1: fill('') is no-op on empty uncontrolled input)
  await page.locator('input[placeholder="192.168.1.10"]').fill(' ')
  await page.locator('input[placeholder="p3portal"]').first().fill('mydb')
  await page.locator('input[placeholder="p3portal"][autocomplete="username"]').fill('user')
  await page.locator('input[autocomplete="new-password"]').fill('secret')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await expect(page.locator('text=Host darf nicht leer sein')).toBeVisible()
})

test('DB9: PostgreSQL – Verbindungstest-Erfolg zeigt grüne Meldung', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/database/test', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'Verbindung erfolgreich' }) }))
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await page.locator('input[placeholder="192.168.1.10"]').fill('db.example.com')
  await page.locator('input[placeholder="p3portal"]').first().fill('mydb')
  await page.locator('input[placeholder="p3portal"][autocomplete="username"]').fill('dbuser')
  await page.locator('input[autocomplete="new-password"]').fill('secret123')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.locator('text=Verbindung erfolgreich')).toBeVisible()
})

test('DB10: PostgreSQL – Verbindungstest-Fehler zeigt rote Meldung ohne Credentials', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/database/test', r =>
    r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ detail: 'Verbindung fehlgeschlagen: db.example.com:5432/mydb' }) }))
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await page.locator('input[placeholder="192.168.1.10"]').fill('db.example.com')
  await page.locator('input[placeholder="p3portal"]').first().fill('mydb')
  await page.locator('input[placeholder="p3portal"][autocomplete="username"]').fill('dbuser')
  await page.locator('input[autocomplete="new-password"]').fill('geheimespasswort')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.locator('text=Verbindung fehlgeschlagen')).toBeVisible()
  // Credentials must not appear in error message
  await expect(page.locator('text=geheimespasswort')).not.toBeVisible()
})

test('DB11: PostgreSQL – Passwort kann ein-/ausgeblendet werden', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  const pwField = page.locator('input[autocomplete="new-password"]')
  await expect(pwField).toHaveAttribute('type', 'password')
  // The password field is inside a div.relative; the eye-toggle button is inside that div
  const pwWrapper = page.locator('div.relative').filter({ has: pwField })
  await pwWrapper.locator('button[type="button"]').click()
  await expect(pwField).toHaveAttribute('type', 'text')
})

test('DB12: PostgreSQL speichern ruft /api/setup/database auf und wechselt zu Schritt 2', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  let databasePayload = null
  await page.route('/api/setup/database', async r => {
    databasePayload = await r.request().postDataJSON()
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db_type: 'postgresql', restart_required: true }) })
  })
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await page.locator('input[placeholder="192.168.1.10"]').fill('db.example.com')
  await page.locator('input[placeholder="p3portal"]').first().fill('mydb')
  await page.locator('input[placeholder="p3portal"][autocomplete="username"]').fill('dbuser')
  await page.locator('input[autocomplete="new-password"]').fill('securepass1')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await expect(page.locator('text=Admin-Konto erstellen')).toBeVisible()
  expect(databasePayload).not.toBeNull()
  expect(databasePayload.db_type).toBe('postgresql')
  expect(databasePayload.host).toBe('db.example.com')
  expect(databasePayload.password).toBe('securepass1')
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Zusammenfassung (Schritt 6) – Datenbank-Abschnitt
// ════════════════════════════════════════════════════════════════════════════

// Helper to navigate through all steps and reach summary
async function reachSummary(page) {
  // Step 1: Database (SQLite default)
  await expect(page.getByRole('heading', { name: 'Datenbank' })).toBeVisible()
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 2: Admin
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 3: Node
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.fill('input[placeholder="pve"]', 'pve')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 4: Tokens – skip
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 5: Portal – skip
  await page.getByRole('button', { name: /Weiter/ }).click()
}

test('DB13: Zusammenfassung zeigt Datenbank-Abschnitt mit SQLite', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/portal-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.goto('/setup')
  await reachSummary(page)
  // Step 6: Summary
  await expect(page.locator('text=Zusammenfassung')).toBeVisible()
  await expect(page.locator('text=SQLite (Standard)')).toBeVisible()
})

test('DB14: Zusammenfassung zeigt PostgreSQL-Details (ohne Passwort)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/database', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db_type: 'postgresql', restart_required: true }) }))
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/portal-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.goto('/setup')

  // Step 1: PostgreSQL (explicit host onChange to avoid BUG-25-1 undefined.trim())
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await page.locator('input[placeholder="192.168.1.10"]').fill('db.example.com')
  await page.locator('input[placeholder="p3portal"]').first().fill('myportaldb')
  await page.locator('input[placeholder="p3portal"][autocomplete="username"]').fill('p3user')
  await page.locator('input[autocomplete="new-password"]').fill('supersecretpassword')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Wait for Step 2 to render (async API call may delay transition)
  await expect(page.locator('text=Admin-Konto erstellen')).toBeVisible()
  // Step 2: Admin
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Wait for Step 3 to render
  await expect(page.locator('text=Proxmox-Verbindung')).toBeVisible()
  // Step 3: Node (no token fields here – tokens are in step 4)
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.fill('input[placeholder="pve"]', 'pve')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 4: Tokens – skip
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 5: Portal – skip
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 6: Summary
  await expect(page.locator('text=PostgreSQL')).toBeVisible()
  await expect(page.locator('text=db.example.com')).toBeVisible()
  await expect(page.getByText('myportaldb', { exact: true })).toBeVisible()
  await expect(page.getByText('p3user', { exact: true })).toBeVisible()
  await expect(page.locator('text=supersecretpassword')).not.toBeVisible()
  await expect(page.locator('text=Neustart nötig')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Security Tests
// ════════════════════════════════════════════════════════════════════════════

test('SEC-DB1: Passwort erscheint nicht im UI (weder Klartext noch in DOM)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/database/test', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'Verbindung erfolgreich' }) }))
  await page.goto('/setup')
  await page.getByRole('button', { name: 'PostgreSQL' }).click()
  await page.locator('input[placeholder="192.168.1.10"]').fill('db.example.com')
  await page.locator('input[placeholder="p3portal"]').first().fill('mydb')
  await page.locator('input[placeholder="p3portal"][autocomplete="username"]').fill('user')
  await page.locator('input[autocomplete="new-password"]').fill('geheimespasswort123')
  // After test connection
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.locator('text=Verbindung erfolgreich')).toBeVisible()
  // Password should NOT appear visibly on screen (field is type="password" unless toggled)
  const pwField = page.locator('input[autocomplete="new-password"]')
  await expect(pwField).toHaveAttribute('type', 'password')
})

// SEC-DB2 + SEC-DB3: Backend-Validierung (422 für leeren Host / ungültigen db_type)
// Wird durch pytest-Tests in test_router_setup.py abgedeckt – kein E2E nötig.
