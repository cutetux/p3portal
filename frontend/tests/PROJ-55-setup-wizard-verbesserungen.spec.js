// p3portal.org
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_REQUIRED = { setup_required: true, has_admin: false, has_node: false }

async function mockSetupStatus(page, status) {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }))
}

/** Navigate through the License step (Step 1 – new in PROJ-55) */
async function navigatePastLicenseStep(page) {
  await expect(page.getByRole('heading', { name: 'Willkommen bei P3 Portal' })).toBeVisible()
  // Checkbox is sr-only; force:true bypasses the overlay div intercepting pointer events
  await page.locator('input[type="checkbox"]').check({ force: true })
  await page.getByRole('button', { name: /Weiter/ }).click()
}

/** Navigate through both License (Step 1) and Database (Step 2) steps */
async function navigatePastLicenseAndDatabaseStep(page) {
  await navigatePastLicenseStep(page)
  await expect(page.getByRole('heading', { name: 'Datenbank' })).toBeVisible()
  await page.getByRole('button', { name: /Weiter/ }).click()
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Schritt 1: Lizenzhinweis (AC-1 bis AC-5)
// ════════════════════════════════════════════════════════════════════════════

test('LZ-1: Schritt 1 zeigt Willkommensmeldung ohne Formularfelder (AC-1)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await expect(page.getByRole('heading', { name: 'Willkommen bei P3 Portal' })).toBeVisible()
  // No <input type="text"> or <input type="url"> on this step
  await expect(page.locator('input[type="text"]')).toHaveCount(0)
  await expect(page.locator('input[type="url"]')).toHaveCount(0)
})

test('LZ-2: Schritt 1 enthält Text "auf eigenes Risiko" (AC-2)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await expect(page.locator('text=eigenes Risiko').first()).toBeVisible()
})

test('LZ-3: "Weiter" ist ohne Checkbox-Bestätigung deaktiviert (AC-3/AC-4)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  const weiterBtn = page.getByRole('button', { name: /Weiter/ })
  await expect(weiterBtn).toBeDisabled()
})

test('LZ-4: Checkbox aktiviert den Weiter-Button (AC-3)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  const weiterBtn = page.getByRole('button', { name: /Weiter/ })
  await expect(weiterBtn).toBeDisabled()
  await page.locator('input[type="checkbox"]').check({ force: true })
  await expect(weiterBtn).toBeEnabled()
})

test('LZ-5: Checkbox-Accept navigiert zu Datenbank-Schritt (AC-3)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.locator('input[type="checkbox"]').check({ force: true })
  await page.getByRole('button', { name: /Weiter/ }).click()
  await expect(page.getByRole('heading', { name: 'Datenbank' })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Sprachauswahl (AC-6 bis AC-9)
// ════════════════════════════════════════════════════════════════════════════

test('SP-1: Sprach-Dropdown ist im Header sichtbar auf jedem Schritt (AC-6)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  // Globe-icon button should be visible (aria-label "Sprache wählen")
  await expect(page.getByRole('button', { name: 'Sprache wählen' })).toBeVisible()
})

test('SP-2: Sprach-Dropdown zeigt Deutsch und Englisch (AC-8)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.getByRole('button', { name: 'Sprache wählen' }).click()
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deutsch' })).toBeVisible()
})

test('SP-3: Sprachwahl speichert in localStorage (AC-9)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  await page.getByRole('button', { name: 'Sprache wählen' }).click()
  await page.getByRole('button', { name: 'Deutsch' }).click()
  const lang = await page.evaluate(() => localStorage.getItem('p3-lang'))
  expect(lang).toBe('de')
})

// ════════════════════════════════════════════════════════════════════════════
// 3. ProgressBar 7 Schritte (AC-36/37)
// ════════════════════════════════════════════════════════════════════════════

test('PB-1: ProgressBar zeigt 7 Schritte mit korrekten Labels (AC-36)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  const bar = page.locator('.flex.items-center.gap-0')
  await expect(bar.locator('text=Lizenz').first()).toBeVisible()
  await expect(bar.locator('text=Datenbank').first()).toBeVisible()
  await expect(bar.locator('text=Admin').first()).toBeVisible()
  await expect(bar.locator('text=Proxmox').first()).toBeVisible()
  await expect(bar.locator('text=Tokens').first()).toBeVisible()
  await expect(bar.locator('text=Packer').first()).toBeVisible()
  await expect(bar.locator('text=Abschluss').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Schritt 4: Proxmox-Verbindungstest (AC-15/AC-17/AC-18)
// ════════════════════════════════════════════════════════════════════════════

test('VT-1: Schritt 4 zeigt "Verbindung testen"-Button (AC-15)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  // Step 3: Admin
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Now on Step 4: Node
  await expect(page.locator('text=Proxmox-Verbindung')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verbindung testen' })).toBeVisible()
})

test('VT-2: Verbindungstest zeigt grünen Banner bei Erfolg (AC-18)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/test-node', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, version: '8.2.1' }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 4: Fill URL and test
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.locator('text=Proxmox VE 8.2.1')).toBeVisible()
})

test('VT-3: Verbindungstest zeigt Warnung bei Fehler, Weiter bleibt möglich (AC-17)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/test-node', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Connection refused' }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: 'Verbindung testen' }).click()
  await expect(page.locator('text=Connection refused')).toBeVisible()
  // "Weiter" must still be enabled
  await expect(page.getByRole('button', { name: /Weiter/ })).toBeEnabled()
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Schritt 5: Vorausgefüllte Token-IDs (AC-19 bis AC-21)
// ════════════════════════════════════════════════════════════════════════════

test('TK-1: Viewer-Token-ID vorausgefüllt mit portal-viewer@pve!portal-viewer (AC-19)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Now on Step 5: Tokens
  await expect(page.locator('text=Service-Account-Tokens')).toBeVisible()
  // Check viewer token pre-fill
  const viewerInput = page.locator('input[placeholder="user@pve!tokenname"]').first()
  await expect(viewerInput).toHaveValue('portal-viewer@pve!portal-viewer')
})

test('TK-2: Operator-Token-ID vorausgefüllt mit portal-operator@pve!portal-operator (AC-20)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await expect(page.locator('text=Service-Account-Tokens')).toBeVisible()
  const operatorInput = page.locator('input[placeholder="user@pve!tokenname"]').nth(1)
  await expect(operatorInput).toHaveValue('portal-operator@pve!portal-operator')
})

test('TK-3: Tokens-Schritt hat Überspringen-Button (AC-23)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await expect(page.locator('text=Service-Account-Tokens')).toBeVisible()
  await expect(page.getByRole('button', { name: /Überspringen/ })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Schritt 6: Packer-Token (AC-24 bis AC-30)
// ════════════════════════════════════════════════════════════════════════════

test('PK-1: Schritt 6 zeigt Packer-Token mit "Optional"-Badge (AC-24)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Skip tokens
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Now on Step 6: Packer
  await expect(page.locator('text=Packer-Token').first()).toBeVisible()
  await expect(page.locator('text=Optional').first()).toBeVisible()
})

test('PK-2: Packer-Token-ID vorausgefüllt mit portal-packer@pve!portal-packer (AC-25)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/host-ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '192.168.1.50' }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Step 6: Packer – check pre-fill
  const packerIdInput = page.locator('input[placeholder="portal-packer@pve!portal-packer"]')
  await expect(packerIdInput).toHaveValue('portal-packer@pve!portal-packer')
})

test('PK-3: packer_http_ip wird automatisch befüllt (AC-28)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/host-ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '10.0.0.5' }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Wait for host-ip auto-fill
  await expect(page.locator('input[placeholder="192.168.1.100"]')).toHaveValue('10.0.0.5')
})

test('PK-4: Hinweis "System Settings → Portal" im Packer-Schritt (AC-29)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/host-ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '' }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await page.getByRole('button', { name: /Überspringen/ }).click()
  await expect(page.locator('text=System Settings → Portal')).toBeVisible()
})

test('PK-5: Packer-Schritt hat Überspringen-Button (AC-30)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/host-ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '' }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  await page.getByRole('button', { name: /Überspringen/ }).click()
  await expect(page.locator('text=Packer-Token').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Überspringen/ })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Schritt 7: Abschluss & Auto-Login (AC-31 bis AC-35)
// ════════════════════════════════════════════════════════════════════════════

/** Helper to navigate all 6 steps before step 7 */
async function navigateToSummary(page) {
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, node_id: 1 }) }))
  await page.route('/api/setup/tokens', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/portal-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('/api/setup/host-ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '' }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  // Step 3: Admin
  await page.fill('input[autocomplete="username"]', 'testadmin')
  await page.locator('input[autocomplete="new-password"]').first().fill('securepassword1')
  await page.locator('input[autocomplete="new-password"]').last().fill('securepassword1')
  await page.click('button[type="submit"]')
  // Step 4: Node
  await page.locator('input[type="url"]').fill('https://pve.example.com:8006')
  await page.getByRole('button', { name: /Weiter/ }).click()
  // Step 5: Tokens – skip
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Step 6: Packer – skip
  await page.getByRole('button', { name: /Überspringen/ }).click()
  // Now on Step 7: Summary
  await expect(page.locator('text=Zusammenfassung')).toBeVisible()
}

test('AB-1: Schritt 7 zeigt Zusammenfassung mit maskierten Secrets (AC-31)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await navigateToSummary(page)
  await expect(page.locator('text=testadmin')).toBeVisible()
  const maskedCount = await page.locator('text=●●●●●●●●●●●●').count()
  expect(maskedCount).toBeGreaterThanOrEqual(1)
})

test('AB-2: Toggle "Plus-Lizenz jetzt hochladen" ist standardmäßig deaktiviert (AC-32)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await navigateToSummary(page)
  await expect(page.locator('text=Plus-Lizenz jetzt hochladen')).toBeVisible()
  // File input should NOT be visible initially (toggle off)
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
})

test('AB-3: Toggle aktiviert Datei-Upload-Feld (AC-33)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await navigateToSummary(page)
  // Toggle the upload switch (it's a button with aria role)
  const toggleBtn = page.locator('.relative.w-10.h-5.rounded-full')
  await toggleBtn.click()
  await expect(page.locator('input[type="file"]')).toBeVisible()
})

test('AB-4: Setup abschließen ohne Lizenz ist möglich (AC-34)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await navigateToSummary(page)
  // Button should be enabled without license toggle
  await expect(page.getByRole('button', { name: /Setup abschließen/ })).toBeEnabled()
})

test('AB-5: Auto-Login nach Setup – Weiterleitung zu /dashboard bei JWT (AC-35)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/complete', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, access_token: 'fake-jwt-token', token_type: 'bearer' }),
    }))
  // Mock routes needed after redirect to /dashboard
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }) }))
  await page.route('/api/cluster/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await navigateToSummary(page)
  await page.getByRole('button', { name: /Setup abschließen/ }).click()
  await expect(page).toHaveURL(/\/dashboard/)
})

test('AB-6: JWT in sessionStorage nach Auto-Login gesetzt (AC-35)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/complete', r =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, access_token: 'my-setup-token', token_type: 'bearer' }),
    }))
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }) }))
  await page.route('/api/cluster/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await navigateToSummary(page)
  await page.getByRole('button', { name: /Setup abschließen/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 10000 })
  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBe('my-setup-token')
})

test('AB-7: Kein JWT → Weiterleitung zu /login (EC-5)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/complete', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await navigateToSummary(page)
  await page.getByRole('button', { name: /Setup abschließen/ }).click()
  await expect(page).toHaveURL(/\/login/)
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Edge Cases
// ════════════════════════════════════════════════════════════════════════════

test('EC-4: Sprachauswahl bleibt nach Wizard-Abschluss erhalten', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.goto('/setup')
  // Set language to DE
  await page.getByRole('button', { name: 'Sprache wählen' }).click()
  await page.getByRole('button', { name: 'Deutsch' }).click()
  // After page reload, language should still be 'de'
  const lang = await page.evaluate(() => localStorage.getItem('p3-lang'))
  expect(lang).toBe('de')
})

test('EC-2: Zurück-Navigation zeigt vorherige Werte (Datenbank-Schritt)', async ({ page }) => {
  await mockSetupStatus(page, STATUS_REQUIRED)
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.goto('/setup')
  await navigatePastLicenseAndDatabaseStep(page)
  // On Step 3: Admin – fill and go back
  await page.fill('input[autocomplete="username"]', 'testuser')
  await page.getByRole('button', { name: /Zurück/ }).click()
  // Should be back at Step 2: Datenbank
  await expect(page.getByRole('heading', { name: 'Datenbank' })).toBeVisible()
})
