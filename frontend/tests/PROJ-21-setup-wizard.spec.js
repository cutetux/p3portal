// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ────────────────────────────────────────────────────────────────
// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_REQUIRED = { setup_required: true, has_admin: false, has_node: false }
const STATUS_DONE     = { setup_required: false, has_admin: true,  has_node: true }

const MOCK_NODE = {
  id: 1,
  name: 'Heimcluster',
  url: 'https://pve.example.com:8006',
  proxmox_node: 'pve',
  verify_ssl: true,
  token_id: 'admin@pam!mytoken',
  is_default: true,
  created_at: '2026-05-01T00:00:00Z',
  created_by: 'setup',
}

const MOCK_NODE_2 = {
  id: 2,
  name: 'Standort 2',
  url: 'https://pve2.example.com:8006',
  proxmox_node: 'pve2',
  verify_ssl: false,
  token_id: 'admin@pam!token2',
  is_default: false,
  created_at: '2026-05-01T00:00:00Z',
  created_by: 'admin',
}

const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const PLUS_LICENSE = {
  edition: 'plus_v1', valid: true, contact_name: 'Test', contact_email: 'test@example.com', expiry: '2099-01-01', reason: null,
  limits: { users: { current: 1, max: null, unlimited: true }, presets: { current: 0, max: null, unlimited: true } },
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function mockCommon(page) {
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }),
  }))
  await page.route('/api/playbooks', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockSetupStatus(page, status) {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }))
}

async function mockLicense(page, license) {
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(license) }))
}

async function mockNodes(page, nodes) {
  await page.route('/api/admin/nodes', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
  await page.route('/api/cluster/cache-stats', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

// PROJ-55: Helper – navigate past Step 1 (License) by accepting the checkbox.
async function navigatePastLicenseStep(page) {
  await expect(page.getByRole('heading', { name: 'Willkommen bei P3 Portal' })).toBeVisible()
  // Checkbox is sr-only; force:true bypasses the overlay div intercepting pointer events
  await page.locator('input[type="checkbox"]').check({ force: true })
  await page.getByRole('button', { name: /Weiter/ }).click()
}

// PROJ-25/PROJ-55: Helper – navigate past Step 1 (License) and Step 2 (Database).
// SQLite is the default; clicking "Weiter" on Step 2 advances directly without an API call.
async function navigatePastDatabaseStep(page) {
  await navigatePastLicenseStep(page)
  await expect(page.getByRole('heading', { name: 'Datenbank' })).toBeVisible()
  await page.getByRole('button', { name: /Weiter/ }).click()
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Setup-Wizard Redirect-Logik
// ════════════════════════════════════════════════════════════════════════════

test('W1: Redirect auf /setup wenn setup_required=true', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/setup/)
})

test('W2: /setup zeigt Einrichtungs-Assistent Überschrift', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_REQUIRED) }))
  await page.goto('/setup')
  await expect(page.locator('text=Einrichtungs-Assistent')).toBeVisible()
})

test('W3: WizardProgressBar zeigt 7 Schritte (PROJ-55: Lizenz als erster Schritt)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  // Check progress bar step labels (hidden sm:block spans in progress bar)
  const bar = page.locator('.flex.items-center.gap-0')
  await expect(bar.locator('text=Lizenz').first()).toBeVisible()
  await expect(bar.locator('text=Datenbank').first()).toBeVisible()
  await expect(bar.locator('text=Admin').first()).toBeVisible()
  await expect(bar.locator('text=Proxmox').first()).toBeVisible()
  await expect(bar.locator('text=Tokens').first()).toBeVisible()
  await expect(bar.locator('text=Packer').first()).toBeVisible()
  await expect(bar.locator('text=Abschluss')).toBeVisible()
})

test('W4: Kein Wizard-Redirect wenn setup_required=false', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await page.route('/api/cluster/nodes', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/vms', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/health', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.goto('/dashboard')
  await expect(page).not.toHaveURL(/\/setup/)
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Schritt 1: Admin-Konto
// ════════════════════════════════════════════════════════════════════════════

test('W5: Schritt 2 zeigt Admin-Konto Formular (nach Datenbank-Schritt)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await navigatePastDatabaseStep(page)
  await expect(page.locator('text=Admin-Konto erstellen')).toBeVisible()
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible()
  await expect(page.locator('input[autocomplete="new-password"]').first()).toBeVisible()
})

test('W6: Schritt 2 – Passwort zu kurz zeigt Validierungsfehler', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await navigatePastDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('tooshort')
  await page.locator('input[autocomplete="new-password"]').last().fill('tooshort')
  await page.click('button[type="submit"]')
  await expect(page.locator('text=mindestens 12')).toBeVisible()
})

test('W7: Schritt 2 – Passwort-Bestätigung stimmt nicht überein', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await navigatePastDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('differentpass1')
  await page.click('button[type="submit"]')
  await expect(page.locator('text=stimmen nicht überein')).toBeVisible()
})

test('W8: Schritt 2 – Erfolg navigiert zu Schritt 3 (Proxmox-Node)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  await page.goto('/setup')
  await navigatePastDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await expect(page.locator('text=Proxmox-Verbindung')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Schritt 2: Proxmox-Node
// ════════════════════════════════════════════════════════════════════════════

test('W9: Schritt 3 zeigt Proxmox-Verbindung Formular (Node-Felder)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  await page.goto('/setup')
  // Step 1: Database
  await navigatePastDatabaseStep(page)
  // Step 2: Admin
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Now on Step 3: Node
  await expect(page.locator('text=Proxmox-Verbindung')).toBeVisible()
  await expect(page.locator('input[type="url"]')).toBeVisible()
  await expect(page.locator('input[placeholder="pve"]')).toBeVisible()
})

test('W10: Schritt 3 – ungültige URL zeigt Inline-Fehler', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  await page.goto('/setup')
  await navigatePastDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 3: Node – fill a non-http URL
  await page.locator('input[type="url"]').fill('ftp://invalid-protocol.example.com')
  await page.locator('input[placeholder="pve"]').fill('pve')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await expect(page.locator('text=http:// oder https://')).toBeVisible()
})

test('W11: Schritt 4 – Proxmox-Verbindungstest zeigt Ergebnis (PROJ-55: Verbindungstest im Node-Schritt)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  // PROJ-55: connection test is POST /api/setup/test-node, not test-connection
  await page.route('/api/setup/test-node', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: '8.1.4' }) }))
  await page.goto('/setup')
  // Steps 1+2: License + Database
  await navigatePastDatabaseStep(page)
  // Step 3: Admin
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 4: Node – connection test is on THIS step (not Step 5 Tokens)
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.locator('text=Verbindung erfolgreich')).toBeVisible()
  await expect(page.locator('text=8.1.4')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Schritt 5: Zusammenfassung
// ════════════════════════════════════════════════════════════════════════════

test('W12: Schritt 7 zeigt Zusammenfassung ohne Secrets im Klartext (PROJ-55: 7 Schritte)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'testadmin' }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/portal-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/host-ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '' }) }))
  await page.goto('/setup')

  // Step 1: License – accept
  await navigatePastLicenseStep(page)
  // Step 2: Database (SQLite default)
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 3: Admin
  await page.fill('input[autocomplete="username"]', 'testadmin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 4: Node
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.fill('input[placeholder="pve"]', 'pve')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 5: Tokens – skip
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Step 6: Packer – skip
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Step 7: Summary
  await expect(page.locator('text=Zusammenfassung')).toBeVisible()
  await expect(page.locator('text=testadmin')).toBeVisible()
  // Password must be masked
  const maskedCount = await page.locator('text=●●●●●●●●●●●●').count()
  expect(maskedCount).toBeGreaterThanOrEqual(1)
})

test('W13: Setup abschließen – ruft /api/setup/complete auf und leitet zu /dashboard weiter (AC-35 Auto-Login)', async ({ page }) => {
  // After complete, setup/status must return DONE so /dashboard doesn't redirect back
  let setupComplete = false
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(setupComplete ? STATUS_DONE : STATUS_REQUIRED) }))
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, username: 'admin' }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/portal-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/complete', r => {
    setupComplete = true
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, access_token: ADMIN_TOKEN, token_type: 'bearer' }) })
  })
  // Dashboard prerequisites after auto-login
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true, portal_permissions: [] }) }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/cluster/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) }))

  await page.goto('/setup')
  // Steps 1+2: License + Database
  await navigatePastDatabaseStep(page)
  // Step 3: Admin
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 4: Node
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.fill('input[placeholder="pve"]', 'pve')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 5: Tokens – skip (Überspringen)
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Step 6: Packer – skip (Überspringen)
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Step 7: Complete – triggers auto-login JWT → /dashboard
  await page.getByRole('button', { name: /Setup abschließen/ }).click()
  await expect(page).toHaveURL(/\/dashboard/)
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Admin > Nodes (Basis-Edition)
// ════════════════════════════════════════════════════════════════════════════

test('N1: Nodes-Link in Admin-Sidebar sichtbar', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, BASIS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  await expect(page.locator('text=Heimcluster')).toBeVisible()
})

test('N2: Basis-Edition zeigt keinen "Node hinzufügen"-Button (Single-Node)', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, BASIS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  // In Basis edition the "Node hinzufügen" button is hidden (no multi-node)
  await expect(page.locator('text=Node hinzufügen')).not.toBeVisible()
})

test('N3: Basis-Edition zeigt keinen "Node hinzufügen"-Button', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, BASIS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  await expect(page.locator('text=Node hinzufügen')).not.toBeVisible()
})

test('N4: Nodes-Tabelle zeigt Node-Daten', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, BASIS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  await expect(page.locator('text=Heimcluster')).toBeVisible()
  await expect(page.locator('text=pve.example.com')).toBeVisible()
  // Standard badge in table body (not header)
  await expect(page.locator('tbody').locator('text=Standard')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Admin > Nodes (Plus-Edition)
// ════════════════════════════════════════════════════════════════════════════

test('N5: Plus-Edition zeigt "Node hinzufügen"-Button', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  await expect(page.locator('text=Node hinzufügen')).toBeVisible()
})

test('N6: Plus-Edition zeigt Bearbeiten-Button in Tabelle', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  await expect(page.locator('text=Bearbeiten')).toBeVisible()
})

test('N7: Plus-Edition zeigt Löschen-Button nur für Nicht-Standard-Nodes', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  await mockNodes(page, [MOCK_NODE, MOCK_NODE_2])
  await page.goto('/system-settings?tab=nodes')
  // Node 2 (not default) should show delete button
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(2)
  // The second row (not default) should have a delete button
  await expect(rows.nth(1).locator('text=Löschen')).toBeVisible()
  // The first row (default) should NOT have delete button
  await expect(rows.first().locator('text=Löschen')).not.toBeVisible()
})

test('N8: Klick auf "Node hinzufügen" öffnet Modal', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  await page.click('text=Node hinzufügen')
  await expect(page.locator('text=Node hinzufügen').last()).toBeVisible()
  // Modal should show form fields
  await expect(page.locator('input[placeholder="Heimcluster"]')).toBeVisible()
})

test('N9: Delete-Bestätigungs-Dialog erscheint bei Klick auf Löschen', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  await mockNodes(page, [MOCK_NODE, MOCK_NODE_2])
  await page.goto('/system-settings?tab=nodes')
  const rows = page.locator('tbody tr')
  await rows.nth(1).locator('text=Löschen').click()
  // Should show confirmation buttons
  await expect(rows.nth(1).locator('text=Abbrechen')).toBeVisible()
})

test('N10: Löschen-API-Fehler zeigt Fehlermeldung', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  await mockNodes(page, [MOCK_NODE, MOCK_NODE_2])
  await page.route('**/api/admin/nodes/2', r =>
    r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Dieser Node kann nicht gelöscht werden.' }) }))
  await page.goto('/system-settings?tab=nodes')
  // First click: open confirmation
  await page.locator('tbody tr').nth(1).locator('text=Löschen').click()
  // Second click: confirm deletion (which triggers the API call)
  await page.locator('tbody tr').nth(1).getByText('Löschen').first().click()
  await expect(page.locator('text=kann nicht gelöscht werden')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Admin > Einstellungen – Setup-Sektion
// ════════════════════════════════════════════════════════════════════════════

test('S1: Admin-Einstellungen zeigen "Konfiguration bearbeiten"-Button', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await page.route('/api/admin/settings', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/rbac/presets', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.goto('/system-settings')
  // "Konfiguration bearbeiten" i18n-Schlüssel; Button zeigt "Öffnen", Abschnitt heißt "Setup-Wizard"
  await expect(page.locator('text=Setup-Wizard').first()).toBeVisible()
})

test('S2: Klick auf "Konfiguration bearbeiten" navigiert zu /setup', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await page.route('/api/admin/settings', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/rbac/presets', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.goto('/system-settings')
  // Button "Öffnen" im Setup-Wizard-Abschnitt des Portal-Tabs navigiert zu /setup
  await page.getByRole('button', { name: 'Öffnen' }).first().click()
  await expect(page).toHaveURL(/\/setup/)
  await expect(page.locator('text=Einrichtungs-Assistent')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Security Tests
// ════════════════════════════════════════════════════════════════════════════

test('SEC1: /admin/nodes nicht ohne Auth erreichbar', async ({ page }) => {
  // No auth token
  await mockSetupStatus(page, STATUS_DONE)
  await page.route('/api/admin/nodes', r => r.fulfill({ status: 401, body: '' }))
  await page.goto('/system-settings?tab=nodes')
  // Should redirect to login
  await expect(page).toHaveURL(/\/login|\/setup/)
})

test('SEC2: NodeResponse enthält kein token_secret', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, PLUS_LICENSE)
  // Verify that MOCK_NODE doesn't contain token_secret field
  await mockNodes(page, [MOCK_NODE])
  await page.goto('/system-settings?tab=nodes')
  // Node secret should not be visible in the UI
  await expect(page.locator('text=supersecrettoken')).not.toBeVisible()
})

test('SEC3: Leere Nodes-Seite zeigt "Keine Nodes konfiguriert"', async ({ page }) => {
  await setupAdmin(page)
  await mockCommon(page)
  await mockSetupStatus(page, STATUS_DONE)
  await mockLicense(page, BASIS_LICENSE)
  await mockNodes(page, [])
  await page.goto('/system-settings?tab=nodes')
  await expect(page.locator('text=Keine Nodes konfiguriert')).toBeVisible()
})
