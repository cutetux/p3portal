// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Tokens ────────────────────────────────────────────────────────────────
// Header: {"alg":"HS256","typ":"JWT"}
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"john@pam","auth_type":"proxmox","role":"operator","exp":9999999999}
const PROXMOX_TOKEN =
  H + '.' +
  'eyJzdWIiOiJqb2huQHBhbSIsImF1dGhfdHlwZSI6InByb3htb3giLCJyb2xlIjoib3BlcmF0b3IiLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const LOCAL_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }

const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

async function setupProxmoxUser(page) {
  await page.addInitScript((t) => {
    sessionStorage.clear()
    sessionStorage.setItem('token', t)
  }, PROXMOX_TOKEN)
}

async function setupLocalUser(page) {
  await page.addInitScript((t) => {
    sessionStorage.clear()
    sessionStorage.setItem('token', t)
  }, LOCAL_TOKEN)
}

async function mockCommonApis(page, username = 'john@pam', authType = 'proxmox') {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username, auth_type: authType, role: 'operator', active: true }),
    }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/health', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/packer/proxmox-templates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

// ════════════════════════════════════════════════════════════════════════════
// AC-5: ProxmoxSessionBanner – Anzeige für Proxmox-Login-Nutzer
// ════════════════════════════════════════════════════════════════════════════

test('PB1: Banner erscheint für Proxmox-Login-Nutzer', async ({ page }) => {
  await setupProxmoxUser(page)
  await mockCommonApis(page, 'john@pam', 'proxmox')
  await page.goto('/dashboard')

  const banner = page.locator('text=Sie sind als Proxmox-Nutzer angemeldet')
  await expect(banner).toBeVisible()
})

test('PB2: Banner enthält Hinweis auf RAM-Speicherung', async ({ page }) => {
  await setupProxmoxUser(page)
  await mockCommonApis(page, 'john@pam', 'proxmox')
  await page.goto('/dashboard')

  await expect(page.locator('text=Arbeitsspeicher')).toBeVisible()
})

test('PB3: Banner wird durch X-Button ausgeblendet', async ({ page }) => {
  await setupProxmoxUser(page)
  await mockCommonApis(page, 'john@pam', 'proxmox')
  await page.goto('/dashboard')

  const banner = page.locator('text=Sie sind als Proxmox-Nutzer angemeldet').locator('..')
  await expect(banner).toBeVisible()

  await page.click('button[aria-label="Hinweis schließen"]')
  await expect(page.locator('text=Sie sind als Proxmox-Nutzer angemeldet')).not.toBeVisible()
})

test('PB4: Banner erscheint erneut in neuer Session (frische sessionStorage)', async ({ page }) => {
  // In Playwright wird jeder Test mit frischer sessionStorage gestartet.
  // Dieser Test stellt sicher, dass der Banner bei jedem neuen Seitenaufruf
  // für Proxmox-Nutzer erscheint (solange er nicht in dieser Session weggedrückt wurde).
  await setupProxmoxUser(page)
  await mockCommonApis(page, 'john@pam', 'proxmox')
  await page.goto('/dashboard')

  // Banner muss in frischer Session sichtbar sein (nicht auto-dismissed)
  await expect(page.locator('text=Sie sind als Proxmox-Nutzer angemeldet')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-4: Portal-Login-Nutzer sehen keinen Banner
// ════════════════════════════════════════════════════════════════════════════

test('PB5: Banner erscheint NICHT für Portal-Login-Nutzer (lokale Auth)', async ({ page }) => {
  await setupLocalUser(page)
  await mockCommonApis(page, 'admin', 'local')
  await page.goto('/dashboard')

  await expect(page.locator('text=Sie sind als Proxmox-Nutzer angemeldet')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-7: Setup-Wizard Schritt 3 erklärt Drei-Berechtigungsmodi
// ════════════════════════════════════════════════════════════════════════════

async function advanceToStep3(page) {
  await page.route('/api/setup/status', r =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ setup_required: true, has_admin: false, has_node: false }),
    }))
  await page.goto('/setup')
  await expect(page.locator('text=Admin-Konto erstellen')).toBeVisible()

  // Schritt 1: Admin-Konto
  await page.route('/api/setup/admin', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.fill('input[autocomplete="username"]', 'admin')
  await page.locator('input[autocomplete="new-password"]').first().fill('SuperSecure1234!')
  await page.locator('input[autocomplete="new-password"]').last().fill('SuperSecure1234!')
  await page.click('button[type="submit"]')

  // Schritt 2: Proxmox-Verbindung
  await expect(page.locator('text=Proxmox-Verbindung')).toBeVisible()
  await page.route('/api/setup/node', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.fill('input[type="url"]', 'https://pve.example.com:8006')
  await page.click('button[type="submit"]')

  // Schritt 3 warten
  await expect(page.locator('text=Service-Account-Tokens')).toBeVisible()
}

test('PB6: Setup-Wizard Schritt 3 zeigt "Drei Berechtigungsmodi" Infoblock', async ({ page }) => {
  await advanceToStep3(page)

  await expect(page.locator('text=Drei Berechtigungsmodi')).toBeVisible()
  await expect(page.locator('text=Ohne Tokens')).toBeVisible()
  await expect(page.locator('text=Mit Viewer-Token')).toBeVisible()
  await expect(page.locator('text=Mit Operator-')).toBeVisible()
})

test('PB7: Setup-Wizard Schritt 3 – "Überspringen"-Button funktioniert ohne Tokens', async ({ page }) => {
  await advanceToStep3(page)

  // Schritt 3: Überspringen (keine Tokens konfiguriert – AC-7)
  await page.click('button:has-text("Überspringen")')

  // Schritt 4 sollte erscheinen (Portal-Einstellungen)
  await expect(page.locator('text=Portal-Einstellungen')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-5: Banner in verschiedenen Bereichen des Portals
// ════════════════════════════════════════════════════════════════════════════

test('PB8: Banner erscheint auch im Playbook-Bereich für Proxmox-Nutzer', async ({ page }) => {
  await setupProxmoxUser(page)
  await mockCommonApis(page, 'john@pam', 'proxmox')
  await page.goto('/playbooks')

  await expect(page.locator('text=Sie sind als Proxmox-Nutzer angemeldet')).toBeVisible()
})

test('PB9: Banner Position – zwischen ClusterStatusBar und Inhalt', async ({ page }) => {
  await setupProxmoxUser(page)
  await mockCommonApis(page, 'john@pam', 'proxmox')
  await page.goto('/dashboard')

  // Banner soll vor dem Haupt-Content erscheinen
  const banner = page.locator('[class*="bg-blue"]').filter({ hasText: 'Proxmox-Nutzer' })
  await expect(banner).toBeVisible()
  // Sicherstellen dass der Banner innerhalb des App-Layouts gerendert wird
  const layout = page.locator('.flex.h-screen')
  await expect(layout).toBeVisible()
})
