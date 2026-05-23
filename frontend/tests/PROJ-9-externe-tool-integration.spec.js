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

// ── Mock-Daten ────────────────────────────────────────────────────────────────
const STATUS_DONE   = { setup_required: false, has_admin: true, has_node: true }
const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const MOCK_KEYS = [
  {
    id: 1,
    name: 'iTop-Integration',
    description: 'Automatisierung aus iTop heraus',
    key_prefix: 'p3k_a1b2c3',
    scopes: ['jobs:start', 'jobs:read'],
    created_at: '2026-05-03T10:00:00Z',
    expires_at: null,
    revoked_at: null,
    last_used_at: '2026-05-03T11:30:00Z',
    status: 'active',
  },
  {
    id: 2,
    name: 'Abgelaufener Key',
    description: null,
    key_prefix: 'p3k_x9y8z7',
    scopes: ['cluster:read'],
    created_at: '2025-01-01T00:00:00Z',
    expires_at: '2025-12-31T23:59:59Z',
    revoked_at: null,
    last_used_at: null,
    status: 'expired',
  },
  {
    id: 3,
    name: 'Widerrufener Key',
    description: null,
    key_prefix: 'p3k_d4e5f6',
    scopes: ['packer:start'],
    created_at: '2026-04-01T00:00:00Z',
    expires_at: null,
    revoked_at: '2026-04-15T08:00:00Z',
    last_used_at: null,
    status: 'revoked',
  },
]

const MOCK_LOGS = [
  {
    id: 1,
    api_key_id: 1,
    api_key_name: 'iTop-Integration',
    scope_used: 'jobs:start',
    method: 'POST',
    endpoint: '/api/v1/jobs',
    status_code: 202,
    job_id: 'abc12345-def6-7890-abcd-ef1234567890',
    playbook: 'proxmox_create_vm',
    node: 'pve1',
    callback_url: 'https://itop.example.com/callback',
    called_at: '2026-05-03T11:30:00Z',
  },
  {
    id: 2,
    api_key_id: 1,
    api_key_name: 'iTop-Integration',
    scope_used: 'jobs:read',
    method: 'GET',
    endpoint: '/api/v1/jobs/abc12345',
    status_code: 200,
    job_id: 'abc12345-def6-7890-abcd-ef1234567890',
    playbook: null,
    node: null,
    callback_url: null,
    called_at: '2026-05-03T11:31:00Z',
  },
]

// ── Helfer ────────────────────────────────────────────────────────────────────
async function setToken(page, token) {
  await page.addInitScript((t) => {
    sessionStorage.clear()
    sessionStorage.setItem('token', t)
  }, token)
}

async function mockBaseApis(page, role = 'admin') {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: role, auth_type: 'local', role, active: true }) }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/jobs', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/logs*', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ logs: [], total: 0, offset: 0, limit: 100 }) }))
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockApiKeys(page, keys = MOCK_KEYS) {
  await page.route('/api/admin/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(keys) })
    } else {
      r.continue()
    }
  })
}

async function mockApiLogs(page, logs = MOCK_LOGS) {
  await page.route('/api/admin/api-keys/logs*', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logs) }))
}

// ════════════════════════════════════════════════════════════════════════════
// AC1: Seite /admin/api-keys nur für Portal-Admins sichtbar
// ════════════════════════════════════════════════════════════════════════════

test('AC1a: Admin sieht "API-Keys"-Link in der Sidebar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await expect(page.locator('nav a[href="/admin/api-keys"]')).toBeVisible()
})

test('AC1b: Operator sieht keinen "API-Keys"-Link in der Sidebar', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockBaseApis(page, 'operator')
  await page.goto('/dashboard')
  await expect(page.locator('nav a[href="/admin/api-keys"]')).not.toBeVisible()
})

test('AC1c: Operator wird von /admin/api-keys wegge leitet', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockBaseApis(page, 'operator')
  await page.goto('/admin/api-keys')
  // ProtectedLayout redirects non-admins away from admin routes
  await expect(page).not.toHaveURL('/admin/api-keys')
})

// ════════════════════════════════════════════════════════════════════════════
// AC2: Tabelle mit API-Keys (Name, Scopes, Erstellt, Ablauf, Letzter Aufruf, Status)
// ════════════════════════════════════════════════════════════════════════════

test('AC2a: Tabelle zeigt vorhandene Keys mit Scope-Badges und Status', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await expect(page.locator('h1:has-text("API-Key-Verwaltung")')).toBeVisible()
  // Aktiver Key
  await expect(page.locator('td:has-text("iTop-Integration")')).toBeVisible()
  // Scope-Badges
  await expect(page.locator('span.font-mono:has-text("jobs:start")')).toBeVisible()
  await expect(page.locator('span.font-mono:has-text("jobs:read")')).toBeVisible()
  // Status-Badges
  await expect(page.locator('span:has-text("Aktiv")')).toBeVisible()
  await expect(page.locator('span:has-text("Abgelaufen")')).toBeVisible()
  await expect(page.locator('span:has-text("Widerrufen")')).toBeVisible()
})

test('AC2b: Leere Tabelle zeigt passenden Hinweis', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await expect(page.locator('text=Noch keine API-Keys vorhanden')).toBeVisible()
})

test('AC2c: Key-Prefix wird angezeigt (p3k_… Format)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  // Prefix "p3k_a1b2c3…" should appear
  await expect(page.locator('text=p3k_a1b2c3…')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC3: Key erstellen – Modal mit Scopes-Checkboxen und Ablaufdatum
// ════════════════════════════════════════════════════════════════════════════

test('AC3a: "Neuen Key erstellen"-Button öffnet Create-Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  await expect(page.locator('h2:has-text("Neuen API-Key erstellen")')).toBeVisible()
})

test('AC3b: Create-Modal zeigt alle vier Scopes als Checkboxen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  await expect(page.locator('span.font-mono:has-text("jobs:start")')).toBeVisible()
  await expect(page.locator('span.font-mono:has-text("jobs:read")')).toBeVisible()
  await expect(page.locator('span.font-mono:has-text("cluster:read")')).toBeVisible()
  await expect(page.locator('span.font-mono:has-text("packer:start")')).toBeVisible()
})

test('AC3c: Create-Button bleibt disabled wenn kein Scope ausgewählt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  await page.fill('input[placeholder="z.B. iTop-Integration"]', 'Test-Key')
  // No scopes selected → submit button disabled (type="submit" to avoid ambiguity)
  await expect(page.locator('button[type="submit"]:has-text("Key erstellen")')).toBeDisabled()
  await expect(page.locator('text=Mindestens ein Scope erforderlich')).toBeVisible()
})

test('AC3d: Create-Button bleibt disabled wenn kein Name eingegeben', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  // Select a scope but leave name empty
  await page.locator('label:has(span:has-text("jobs:start")) input[type="checkbox"]').check()
  await expect(page.locator('button[type="submit"]:has-text("Key erstellen")')).toBeDisabled()
})

test('AC3e: Ablaufdatum-Feld ist standardmäßig "Kein Ablaufdatum" (versteckt)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  // datetime-local input should NOT be visible when noExpiry=true
  await expect(page.locator('input[type="datetime-local"]')).not.toBeVisible()
})

test('AC3f: Ablaufdatum-Feld erscheint wenn "Kein Ablaufdatum" deaktiviert wird', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  // Uncheck "Kein Ablaufdatum"
  await page.locator('label:has-text("Kein Ablaufdatum") input[type="checkbox"]').uncheck()
  await expect(page.locator('input[type="datetime-local"]')).toBeVisible()
})

test('AC3g: Abbrechen schließt das Create-Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  await expect(page.locator('h2:has-text("Neuen API-Key erstellen")')).toBeVisible()
  await page.click('button:has-text("Abbrechen")')
  await expect(page.locator('h2:has-text("Neuen API-Key erstellen")')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC4: Nach Key-Erstellung: RevealModal zeigt Plaintext-Key einmalig
// ════════════════════════════════════════════════════════════════════════════

test('AC4: Nach Erstellung erscheint RevealModal mit Plaintext-Key und Warnung', async ({ page }) => {
  const NEW_KEY = {
    ...MOCK_KEYS[0],
    id: 99,
    name: 'Neuer CI-Key',
    plaintext_key: 'p3k_' + 'a'.repeat(64),
  }

  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])

  await page.route('/api/admin/api-keys', async (r) => {
    if (r.request().method() === 'POST') {
      r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(NEW_KEY) })
    } else {
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Neuen Key erstellen")')
  await page.fill('input[placeholder="z.B. iTop-Integration"]', 'Neuer CI-Key')
  await page.locator('label:has(span:has-text("jobs:start")) input[type="checkbox"]').check()
  await page.locator('button[type="submit"]:has-text("Key erstellen")').click()

  // RevealModal erscheint
  await expect(page.locator('h2:has-text("API-Key erstellt")')).toBeVisible()
  // Plaintext-Key im dediziierten Anzeige-Div (select-all Klasse)
  await expect(page.locator('div.select-all:has-text("p3k_")')).toBeVisible()
  // Warnung "Dieser Key wird nicht erneut angezeigt"
  await expect(page.locator('text=Dieser Key wird nicht erneut angezeigt')).toBeVisible()
  // Copy-Button vorhanden
  await expect(page.locator('button:has-text("Kopieren")')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC5: Keys widerrufen
// ════════════════════════════════════════════════════════════════════════════

test('AC5a: Aktiver Key hat "Widerrufen"-Button, widerrufener Key nicht', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  // Active key row has revoke button
  const activeRow = page.locator('tr').filter({ hasText: 'iTop-Integration' })
  await expect(activeRow.locator('button:has-text("Widerrufen")')).toBeVisible()
  // Revoked key row has no revoke button
  const revokedRow = page.locator('tr').filter({ hasText: 'Widerrufener Key' })
  await expect(revokedRow.locator('button:has-text("Widerrufen")')).not.toBeVisible()
})

test('AC5b: Klick auf Widerrufen öffnet Bestätigungs-Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  const activeRow = page.locator('tr').filter({ hasText: 'iTop-Integration' })
  await activeRow.locator('button:has-text("Widerrufen")').click()
  // Confirm modal should appear
  await expect(page.locator('text=widerrufen').first()).toBeVisible()
})

test('AC5c: Widerrufene Keys bleiben in der Tabelle mit Status "Widerrufen" sichtbar', async ({ page }) => {
  // Spec: widerrufene/abgelaufene Keys bleiben in der Tabelle (nicht gelöscht)
  // Test: Mock-Daten enthalten bereits revoked Key → Status "Widerrufen" in Tabelle
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)   // includes revoked key (MOCK_KEYS[2])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  // Revoked key shows "Widerrufen" badge and remains in table
  const revokedRow = page.locator('tr').filter({ hasText: 'Widerrufener Key' })
  await expect(revokedRow).toBeVisible()
  await expect(revokedRow.locator('span:has-text("Widerrufen")')).toBeVisible()
  // Revoked key has no "Widerrufen" action button but still has "Löschen"
  await expect(revokedRow.locator('button:has-text("Widerrufen")')).not.toBeVisible()
  await expect(revokedRow.locator('button:has-text("Löschen")')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC6: Keys endgültig löschen
// ════════════════════════════════════════════════════════════════════════════

test('AC6a: Jeder Key hat einen "Löschen"-Button (auch widerrufene)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  // All rows should have a delete button
  const deleteButtons = page.locator('button:has-text("Löschen")')
  await expect(deleteButtons).toHaveCount(MOCK_KEYS.length)
})

test('AC6b: Klick auf Löschen öffnet Bestätigungs-Dialog', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  const firstRow = page.locator('tr').filter({ hasText: 'iTop-Integration' })
  await firstRow.locator('button:has-text("Löschen")').click()
  await expect(page.locator('text=löschen').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC7: Tab "Audit-Log" – Einträge anzeigen
// ════════════════════════════════════════════════════════════════════════════

test('AC7a: Tab "Audit-Log" ist sichtbar und wechselbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await expect(page.locator('button:has-text("Audit-Log")')).toBeVisible()
  await page.click('button:has-text("Audit-Log")')
  await expect(page.locator('h2:has-text("Audit-Log")')).toBeVisible()
})

test('AC7b: Audit-Log zeigt API-Calls mit Key-Name, Scope, Methode und Endpunkt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, MOCK_LOGS)
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Audit-Log")')
  await expect(page.locator('td:has-text("iTop-Integration")').first()).toBeVisible()
  await expect(page.locator('span:has-text("jobs:start")')).toBeVisible()
  await expect(page.locator('td:has-text("POST")')).toBeVisible()
  await expect(page.locator('td[title="/api/v1/jobs"]')).toBeVisible()
})

test('AC7c: Leeres Audit-Log zeigt Hinweis "Noch keine Audit-Log-Einträge"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Audit-Log")')
  await expect(page.locator('text=Noch keine Audit-Log-Einträge vorhanden')).toBeVisible()
})

test('AC7d: Audit-Log hat Filter für Key-Name und Scope', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, MOCK_LOGS)
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Audit-Log")')
  // Key-Name filter input exists
  await expect(page.locator('input[placeholder="Suche…"]')).toBeVisible()
  // Scope dropdown exists
  await expect(page.locator('select').last()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC8: Audit-Log zeigt HTTP-Status-Codes farbkodiert
// ════════════════════════════════════════════════════════════════════════════

test('AC8: HTTP-Statuscodes im Audit-Log sind sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, [])
  await mockApiLogs(page, MOCK_LOGS)
  await page.goto('/admin/api-keys')
  await page.click('button:has-text("Audit-Log")')
  await expect(page.locator('td:has-text("202")')).toBeVisible()
  await expect(page.locator('td:has-text("200")')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC9: Beispiel-Request und Swagger-Link auf der API-Keys Seite
// ════════════════════════════════════════════════════════════════════════════

test('AC9: API-Beispiel-Box und Swagger-Link erscheinen wenn Keys vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  await expect(page.locator('code:has-text("Authorization: ApiKey")')).toBeVisible()
  await expect(page.locator('a[href="/api/docs"]')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC10: Widerrufene/abgelaufene Schlüssel erscheinen ausgegraut in der Tabelle
// ════════════════════════════════════════════════════════════════════════════

test('AC10: Inaktive Keys (revoked/expired) sind in der Tabelle ausgegraut', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await mockApiKeys(page, MOCK_KEYS)
  await mockApiLogs(page, [])
  await page.goto('/admin/api-keys')
  // Rows for non-active keys should have opacity-60 class
  const revokedRow = page.locator('tr.opacity-60')
  await expect(revokedRow).toHaveCount(2) // expired + revoked
})

// ════════════════════════════════════════════════════════════════════════════
// AC11: Regression – bestehende Admin-Seiten bleiben funktionsfähig
// ════════════════════════════════════════════════════════════════════════════

test('AC11: Admin-Nutzerseite /admin/users bleibt erreichbar (Regression)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto('/admin/users')
  await expect(page).toHaveURL('/admin/users')
  await expect(page.locator('h1').first()).toBeVisible()
})

test('AC12: Dashboard bleibt nach PROJ-9 erreichbar (Regression)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockBaseApis(page, 'admin')
  await page.route('/api/cluster', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/templates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto('/dashboard')
  await expect(page).toHaveURL('/dashboard')
})
