// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-signature'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_DONE   = { setup_required: false, has_admin: true, has_node: true }
const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null, expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}
const PLUS_LICENSE = {
  edition: 'plus', valid: true, contact_name: 'Test', contact_email: 'test@example.com', expiry: null, reason: null,
  limits: { users: { current: 1, max: 6, unlimited: true }, presets: { current: 0, max: 5, unlimited: true } },
}

const MOCK_KEYS = [
  {
    id: 1,
    name: 'GitLab CI',
    key_prefix: 'upk_abc1234',
    scopes: ['jobs:write', 'cluster:read'],
    expires_at: null,
    last_used_at: '2026-05-01T10:00:00Z',
    created_at: '2026-04-01T00:00:00Z',
    is_active: true,
  },
]

const CREATED_KEY_RESPONSE = {
  id: 2,
  name: 'Neuer Test-Key',
  plaintext_key: 'upk_newkey12345abcdefghijklmnopqrst',
  key_prefix: 'upk_newkey1',
  scopes: ['cluster:read'],
  expires_at: '2027-05-03T10:00:00Z',
  last_used_at: null,
  created_at: '2026-05-03T00:00:00Z',
  is_active: true,
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => {
    sessionStorage.clear()
    sessionStorage.setItem('token', t)
  }, token)
}

async function mockCommon(page, role = 'operator') {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: role, auth_type: 'local', role, active: true }) }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], vms: [] }) }))
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/auth/logout', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/me/ssh-key', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: null }) }))
  await page.route('/api/me/sessions', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockApiKeysEnabled(page, keys = []) {
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(keys) })
    } else {
      r.continue()
    }
  })
}

async function mockApiKeysDisabled(page) {
  await page.route('/api/profile/api-keys', r =>
    r.fulfill({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ detail: 'API-Keys für diesen Account nicht aktiviert.' }) }))
}

// ════════════════════════════════════════════════════════════════════════════
// AK-1: Tab nur sichtbar wenn api_keys_enabled = true
// ════════════════════════════════════════════════════════════════════════════

test('AK-1: API-Keys-Tab im Profil ist sichtbar wenn Admin aktiviert hat', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  await page.goto('/profile')
  await expect(page.locator('button:has-text("API-Keys")')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-2: Tab nicht sichtbar wenn Admin nicht aktiviert hat
// ════════════════════════════════════════════════════════════════════════════

test('AK-2: API-Keys-Tab ist NICHT sichtbar wenn Admin nicht aktiviert hat', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysDisabled(page)

  await page.goto('/profile')
  await expect(page.locator('button:has-text("API-Keys")')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-3: Key-Liste zeigt vorhandene Keys
// ════════════════════════════════════════════════════════════════════════════

test('AK-3: API-Keys-Tab zeigt vorhandene Keys mit Name, Präfix und Scopes', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, MOCK_KEYS)

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')

  await expect(page.locator('text=GitLab CI')).toBeVisible()
  await expect(page.locator('text=upk_abc1234…')).toBeVisible()
  await expect(page.locator('text=jobs:write')).toBeVisible()
  await expect(page.locator('text=cluster:read')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-4: Empty State wenn keine Keys vorhanden
// ════════════════════════════════════════════════════════════════════════════

test('AK-4: API-Keys-Tab zeigt Empty-State wenn keine Keys vorhanden', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await expect(page.locator('text=Noch keine API-Keys erstellt')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-5: Key erstellen – Modal öffnen
// ════════════════════════════════════════════════════════════════════════════

test('AK-5: Neuer-Key-Button öffnet Erstellungs-Modal', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')

  await expect(page.locator('text=Neuer API-Key')).toBeVisible()
  await expect(page.locator('input[placeholder*="GitLab CI"]')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-6: Key erstellen – Alle Scopes sichtbar (allowedScopes=null)
// ════════════════════════════════════════════════════════════════════════════

test('AK-6: Erstellungs-Modal zeigt alle 6 Scopes wenn Admin keine Einschränkung gesetzt hat', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')

  await expect(page.locator('text=Cluster lesen')).toBeVisible()
  await expect(page.locator('text=Jobs lesen')).toBeVisible()
  await expect(page.locator('text=Jobs starten')).toBeVisible()
  await expect(page.locator('text=Playbooks lesen')).toBeVisible()
  await expect(page.locator('text=Packer lesen')).toBeVisible()
  await expect(page.locator('text=Packer starten')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-7: Key erstellen – Ablaufzeit-Dropdown hat alle Optionen
// ════════════════════════════════════════════════════════════════════════════

test('AK-7: Ablaufzeit-Dropdown im Modal hat alle 5 Optionen (30/90/180/365/Unbegrenzt)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')

  const select = page.locator('select')
  await expect(select.locator('option[value="30"]')).toHaveText('30 Tage')
  await expect(select.locator('option[value="90"]')).toHaveText('90 Tage')
  await expect(select.locator('option[value="180"]')).toHaveText('180 Tage')
  await expect(select.locator('option[value="365"]')).toContainText('1 Jahr')
  await expect(select.locator('option[value="null"]')).toHaveText('Unbegrenzt')
})

// ════════════════════════════════════════════════════════════════════════════
// AK-8: Key erstellen – Validierung: Kein Scope ausgewählt
// ════════════════════════════════════════════════════════════════════════════

test('AK-8: Formular zeigt Fehler wenn kein Scope ausgewählt', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')

  await page.fill('input[placeholder*="GitLab CI"]', 'Test Key')
  await page.click('button:has-text("Key erstellen")')

  await expect(page.locator('text=Mindestens einen Scope auswählen')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-9: Key erstellen – Einmalige Klartext-Anzeige
// ════════════════════════════════════════════════════════════════════════════

test('AK-9: Erstellter Key wird einmalig im Klartext mit upk_-Präfix angezeigt', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])
  await page.route('/api/profile/api-keys', async r => {
    if (r.request().method() === 'POST') {
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(CREATED_KEY_RESPONSE) })
    } else {
      await r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')
  await page.fill('input[placeholder*="GitLab CI"]', 'Neuer Test-Key')
  await page.click('text=Cluster lesen')
  await page.click('button:has-text("Key erstellen")')

  await expect(page.locator('text=API-Key erstellt')).toBeVisible()
  await expect(page.locator('input[aria-label="API-Key"]')).toBeVisible()
  const keyValue = await page.locator('input[aria-label="API-Key"]').inputValue()
  expect(keyValue).toMatch(/^upk_/)
  await expect(page.locator('text=Kopiere den Key jetzt')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-10: Key erstellen – Fertig schließt Modal und aktualisiert Liste
// ════════════════════════════════════════════════════════════════════════════

test('AK-10: Fertig-Button schließt Modal nach Key-Erstellung', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  // Plus-Lizenz: kein 1-Key-Limit → Button bleibt enabled egal wie viele GET-Calls kommen
  await page.route('/api/profile/api-keys', async r => {
    if (r.request().method() === 'POST') {
      await r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(CREATED_KEY_RESPONSE) })
    } else {
      await r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')
  await page.fill('input[placeholder*="GitLab CI"]', 'Neuer Test-Key')
  await page.click('text=Cluster lesen')
  await page.click('button:has-text("Key erstellen")')
  await expect(page.locator('text=API-Key erstellt')).toBeVisible()

  await page.click('button:has-text("Fertig")')
  await expect(page.locator('text=Neuer API-Key')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-11: Key widerrufen
// ════════════════════════════════════════════════════════════════════════════

test('AK-11: Widerrufen-Button entfernt Key aus der Liste', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))

  let keysInStore = [...MOCK_KEYS]
  // Regex matcht sowohl /api/profile/api-keys als auch /api/profile/api-keys/1
  await page.route(/\/api\/profile\/api-keys(\/\d+)?$/, async r => {
    if (r.request().method() === 'DELETE') {
      keysInStore = keysInStore.filter(k => !r.request().url().endsWith(`/${k.id}`))
      await r.fulfill({ status: 204, body: '' })
    } else {
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(keysInStore) })
    }
  })

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await expect(page.locator('text=GitLab CI')).toBeVisible()

  await page.click('button:has-text("Widerrufen")')
  await expect(page.locator('text=GitLab CI')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-12: Basis-Edition Limit – Neuer-Key-Button deaktiviert wenn Limit erreicht
// ════════════════════════════════════════════════════════════════════════════

test('AK-12: Basis-Edition: Neuer-Key-Button deaktiviert wenn 1 aktiver Key vorhanden', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, MOCK_KEYS) // 1 active key

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')

  const btn = page.locator('button:has-text("Neuer Key")')
  await expect(btn).toBeDisabled()
  await expect(page.locator('text=1 / 1 aktive Keys')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-13: Plus-Edition Limit-Anzeige mit mehr Keys
// ════════════════════════════════════════════════════════════════════════════

test('AK-13: Plus-Edition: Neuer-Key-Button aktiv wenn unter Limit', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await mockApiKeysEnabled(page, MOCK_KEYS) // 1 active key, Plus has no server-side max in ProfilePage

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')

  const btn = page.locator('button:has-text("Neuer Key")')
  await expect(btn).not.toBeDisabled()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-14: Admin – API-Key-Einstellungen pro Nutzer sind sichtbar
// ════════════════════════════════════════════════════════════════════════════

test('AK-14: Admin kann API-Key-Einstellungen in Nutzerverwaltung öffnen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysDisabled(page) // Admin's own profile

  const MOCK_USERS = [
    { id: 2, username: 'testuser', role: 'operator', is_active: true, auth_type: 'local',
      api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }
  ]
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) }))
  await page.route('/api/admin/users/2/api-key-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }) }))
  await page.route('/api/admin/users/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS[0]) }))
  await page.route('/api/admin/rbac/users/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/admin/users')
  await expect(page.locator('text=testuser')).toBeVisible()
  await page.click('button:has-text("Bearbeiten")')

  await expect(page.locator('text=API-Keys für diesen Nutzer aktivieren')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-15: Admin – API-Keys aktivieren zeigt Scope-Optionen
// ════════════════════════════════════════════════════════════════════════════

test('AK-15: Admin: Aktivieren des API-Key-Toggles zeigt Scope-Checkboxen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysDisabled(page)

  const MOCK_USERS = [
    { id: 2, username: 'testuser', role: 'operator', is_active: true, auth_type: 'local',
      api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }
  ]
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) }))
  await page.route('/api/admin/users/2/api-key-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }) }))
  await page.route('/api/admin/users/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS[0]) }))
  await page.route('/api/admin/rbac/users/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/admin/users')
  await page.click('button:has-text("Bearbeiten")')
  await expect(page.locator('text=API-Keys für diesen Nutzer aktivieren')).toBeVisible()

  // Click the toggle to enable
  await page.click('label:has-text("API-Keys für diesen Nutzer aktivieren")')

  await expect(page.locator('text=Erlaubte Scopes')).toBeVisible()
  await expect(page.locator('text=Alle Scopes erlauben')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-16: Admin – API-Key-Einstellungen speichern
// ════════════════════════════════════════════════════════════════════════════

test('AK-16: Admin kann API-Key-Einstellungen speichern', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysDisabled(page)

  const MOCK_USERS = [
    { id: 2, username: 'testuser', role: 'operator', is_active: true, auth_type: 'local',
      api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }
  ]
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) }))
  await page.route('/api/admin/users/2/api-key-settings', async r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ api_keys_enabled: false, api_keys_allowed_scopes: null, api_keys_max_count: null }) })
    } else if (r.request().method() === 'PUT') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    }
  })
  await page.route('/api/admin/users/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS[0]) }))
  await page.route('/api/admin/rbac/users/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/admin/users')
  await page.click('button:has-text("Bearbeiten")')
  await page.click('label:has-text("API-Keys für diesen Nutzer aktivieren")')
  await page.click('button:has-text("API-Key-Einstellungen speichern")')

  await expect(page.locator('text=Einstellungen gespeichert')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-17: Abbrechen-Button schließt Modal ohne Aktion
// ════════════════════════════════════════════════════════════════════════════

test('AK-17: Abbrechen-Button im Erstellungs-Modal schließt ohne API-Call', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, [])

  let postCalled = false
  await page.route('/api/profile/api-keys', async r => {
    if (r.request().method() === 'POST') {
      postCalled = true
      r.continue()
    } else {
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await page.click('button:has-text("Neuer Key")')
  await page.fill('input[placeholder*="GitLab CI"]', 'Test Key')
  await page.click('button:has-text("Abbrechen")')

  await expect(page.locator('text=Neuer API-Key')).not.toBeVisible()
  expect(postCalled).toBe(false)
})

// ════════════════════════════════════════════════════════════════════════════
// AK-18: Key-Liste zeigt Ablauf-Info korrekt
// ════════════════════════════════════════════════════════════════════════════

test('AK-18: Key ohne Ablaufzeit zeigt "Nie" in der Ablauf-Spalte', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await mockApiKeysEnabled(page, MOCK_KEYS)

  await page.goto('/profile')
  await page.click('button:has-text("API-Keys")')
  await expect(page.locator('text=Läuft ab: Nie')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AK-19: API-Fehler beim Laden zeigt Fehlermeldung
// ════════════════════════════════════════════════════════════════════════════

test('AK-19: Fehler beim Laden der Keys zeigt Fehlermeldung im Tab', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page)
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))

  // Schritt 1: Route gibt immer 200 → Tab erscheint
  const successHandler = async r => {
    await r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  }
  await page.route('/api/profile/api-keys', successHandler)

  await page.goto('/profile')
  // Warte bis Tab sichtbar (React StrictMode: mehrfache Calls werden alle mit 200 beantwortet)
  await expect(page.locator('button:has-text("API-Keys")')).toBeVisible()

  // Schritt 2: Success-Handler entfernen, Fehler-Handler registrieren
  await page.unroute('/api/profile/api-keys', successHandler)
  await page.route('/api/profile/api-keys', async r =>
    r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail": "Server error"}' }))

  // Tab-Klick → ApiKeysTab mountet → listMyApiKeys() → 500 → Fehlermeldung
  await page.click('button:has-text("API-Keys")')
  await expect(page.locator('text=API-Keys konnten nicht geladen werden')).toBeVisible({ timeout: 10000 })
})
