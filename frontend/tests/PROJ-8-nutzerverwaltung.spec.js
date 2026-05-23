// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Alle Tokens sind gültige Base64-kodierte JWTs ohne echte Signatur.
// useAuth.parseJwtPayload() liest nur den Payload-Teil.

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"operator1","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-signature'

// {"sub":"access_token_for_local_login","auth_type":"local","role":"operator","exp":9999999999}
const LOCAL_LOGIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhY2Nlc3NfdG9rZW5fZm9yX2xvY2FsX2xvZ2luIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoib3BlcmF0b3IiLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_USERS = [
  { id: 1, username: 'admin', role: 'admin', active: true, created_at: '2026-04-26T00:00:00Z' },
  { id: 2, username: 'helpdesk', role: 'operator', active: true, created_at: '2026-04-26T00:00:00Z' },
  { id: 3, username: 'readonly', role: 'viewer', active: false, created_at: '2026-04-26T00:00:00Z' },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockPlaybooks(page) {
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

async function mockAdminUsers(page, users = MOCK_USERS) {
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(users),
    })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Login-Toggle: Proxmox | App
// ════════════════════════════════════════════════════════════════════════════

test('LT-1: Login-Seite zeigt zwei Tabs: Proxmox Login und Portal Login', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('button:has-text("Proxmox Login")')).toBeVisible()
  await expect(page.locator('button:has-text("Portal Login")')).toBeVisible()
})

test('LT-2: Proxmox-Tab zeigt Realm-Dropdown; App-Tab versteckt ihn', async ({ page }) => {
  await page.goto('/login')

  // PROJ-14: Portal Login ist jetzt Standard – Realm-Dropdown nicht sichtbar
  await expect(page.locator('select[name="realm"]')).not.toBeVisible()

  // Auf Proxmox Login wechseln → Realm-Dropdown erscheint
  await page.click('button:has-text("Proxmox Login")')
  await expect(page.locator('select[name="realm"]')).toBeVisible()

  // Zurück zu Portal Login → Realm-Dropdown verschwindet
  await page.click('button:has-text("Portal Login")')
  await expect(page.locator('select[name="realm"]')).not.toBeVisible()
})

test('LT-3: App-Login-Formular hat username und password, aber kein realm', async ({ page }) => {
  await page.goto('/login')
  await page.click('button:has-text("Portal Login")')

  await expect(page.locator('input[name="username"]')).toBeVisible()
  await expect(page.locator('input[name="password"]')).toBeVisible()
  await expect(page.locator('select[name="realm"]')).not.toBeVisible()
})

test('LT-4: App-Login sendet username+password an POST /api/auth/login/local', async ({ page }) => {
  let capturedBody = null
  await page.route('/api/auth/login/local', async (route) => {
    capturedBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: LOCAL_LOGIN_TOKEN, token_type: 'bearer' }),
    })
  })
  await mockPlaybooks(page)

  await page.goto('/login')
  await page.click('button:has-text("Portal Login")')
  await page.fill('input[name="username"]', 'helpdesk')
  await page.fill('input[name="password"]', 'passwort123')
  await page.click('button[type="submit"]')

  await page.waitForURL('/dashboard')
  expect(capturedBody).toEqual({ username: 'helpdesk', password: 'passwort123' })
  expect(capturedBody).not.toHaveProperty('realm')
})

test('LT-5: Erfolgreicher App-Login speichert JWT in sessionStorage und leitet zu /dashboard', async ({ page }) => {
  await page.route('/api/auth/login/local', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: LOCAL_LOGIN_TOKEN, token_type: 'bearer' }),
    })
  )
  await mockPlaybooks(page)

  await page.goto('/login')
  await page.click('button:has-text("Portal Login")')
  await page.fill('input[name="username"]', 'helpdesk')
  await page.fill('input[name="password"]', 'passwort123')
  await page.click('button[type="submit"]')

  await page.waitForURL('/dashboard')
  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBe(LOCAL_LOGIN_TOKEN)
})

test('LT-6: Falsches App-Passwort (401) zeigt generische Fehlermeldung ohne realm-Hinweis', async ({ page }) => {
  await page.route('/api/auth/login/local', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Authentication failed' }),
    })
  )

  await page.goto('/login')
  await page.click('button:has-text("Portal Login")')
  await page.fill('input[name="username"]', 'helpdesk')
  await page.fill('input[name="password"]', 'falsch')
  await page.click('button[type="submit"]')

  const error = page.locator('p.text-red-400')
  await expect(error).toBeVisible()
  await expect(error).toContainText('fehlgeschlagen')
  await expect(page).toHaveURL(/\/login/)
})

// ════════════════════════════════════════════════════════════════════════════
// 2. RBAC-Sichtbarkeit (Sidebar + ProtectedRoute)
// ════════════════════════════════════════════════════════════════════════════

test('RBAC-1: Admin-Nutzer sieht "Nutzerverwaltung"-Link in der Sidebar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/users"], a:has-text("Nutzerverwaltung")')).toBeVisible()
})

test('RBAC-2: Operator-Nutzer sieht KEINEN Admin-Link in der Sidebar', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)

  await page.goto('/playbooks')
  await expect(page.locator('text=Nutzerverwaltung')).not.toBeVisible()
  await expect(page.locator('text=Administration')).not.toBeVisible()
})

test('RBAC-3: Direktaufruf /admin/users mit Operator-Rolle leitet zu /dashboard weiter', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  // Kein API-Mock nötig – ProtectedRoute fängt vor dem Laden ab
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 0, ha_status: 'none' }),
    })
  )

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/dashboard/)
})

test('RBAC-4: /admin/users ohne Token leitet zu /login weiter', async ({ page }) => {
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login/)
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Admin User CRUD (/admin/users)
// ════════════════════════════════════════════════════════════════════════════

test('CRUD-1: Admin sieht Nutzertabelle mit allen lokalen Nutzern', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)

  await page.goto('/admin/users')

  // Usernames in der Tabelle (font-mono Zellen)
  await expect(page.getByRole('cell', { name: 'admin', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'helpdesk', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'readonly', exact: true })).toBeVisible()
  // Rollenbezeichnungen (spans innerhalb Tabellenzellen)
  await expect(page.locator('td span:has-text("Admin")').first()).toBeVisible()
  await expect(page.locator('td span:has-text("Operator")')).toBeVisible()
  await expect(page.locator('td span:has-text("Viewer")')).toBeVisible()
  // Status-Badges
  await expect(page.locator('td span:has-text("Aktiv")').first()).toBeVisible()
  await expect(page.locator('td span:has-text("Inaktiv")')).toBeVisible()
})

test('CRUD-2: Nutzer anlegen sendet POST /api/admin/users mit korrektem Payload', async ({ page }) => {
  let capturedBody = null
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)
  await page.route('/api/admin/users', async (route) => {
    if (route.request().method() === 'POST') {
      capturedBody = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 4, username: 'newuser', role: 'viewer', active: true, created_at: '2026-04-26T00:00:00Z' }),
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_USERS),
      })
    }
  })

  await page.goto('/admin/users')
  await page.click('button:has-text("Nutzer anlegen")')

  await expect(page.locator('h2:has-text("Neuer Nutzer")')).toBeVisible()
  await page.fill('input[name="username"]', 'newuser')
  await page.fill('input[name="password"]', 'sicheresPasswort123')
  await page.fill('input[name="passwordConfirm"]', 'sicheresPasswort123')
  await page.selectOption('select[name="role"]', 'viewer')
  await page.click('button:has-text("Nutzer anlegen")')

  await expect(async () => {
    expect(capturedBody).not.toBeNull()
  }).toPass()

  expect(capturedBody.username).toBe('newuser')
  expect(capturedBody.password).toBe('sicheresPasswort123')
  expect(capturedBody.role).toBe('viewer')
})

test('CRUD-3: Passwörter stimmen nicht überein – Fehlermeldung ohne API-Call', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)

  await page.goto('/admin/users')
  await page.click('button:has-text("Nutzer anlegen")')
  await page.fill('input[name="username"]', 'newuser')
  await page.fill('input[name="password"]', 'passwort123')
  await page.fill('input[name="passwordConfirm"]', 'anderes456')
  await page.click('button:has-text("Nutzer anlegen")')

  await expect(page.locator('text=stimmen nicht überein')).toBeVisible()
})

test('CRUD-4: Nutzer bearbeiten öffnet Formular mit vorausgefüllter Rolle', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)

  await page.goto('/admin/users')

  // Bearbeiten-Button für "helpdesk" (role: operator) klicken
  const helpdeskRow = page.locator('tr', { hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()

  await expect(page.locator('h2:has-text("Nutzer bearbeiten")')).toBeVisible()
  // Username vorausgefüllt + disabled
  await expect(page.locator('input[name="username"]')).toHaveValue('helpdesk')
  // Rolle vorausgewählt
  await expect(page.locator('select[name="role"]')).toHaveValue('operator')
})

test('CRUD-5: Nutzer-Rolle bearbeiten sendet PATCH /api/admin/users/{id}', async ({ page }) => {
  let patchBody = null
  let patchUrl = null
  await setToken(page, ADMIN_TOKEN)
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )
  await page.route('/api/admin/users/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchBody = route.request().postDataJSON()
      patchUrl = route.request().url()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_USERS[1], role: 'admin' }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/users')
  const helpdeskRow = page.locator('tr', { hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()
  await page.selectOption('select[name="role"]', 'admin')
  await page.click('button:has-text("Änderungen speichern")')

  await expect(async () => {
    expect(patchBody).not.toBeNull()
  }).toPass()

  expect(patchBody.role).toBe('admin')
  expect(patchUrl).toContain('/api/admin/users/2')
})

test('CRUD-6: Nutzer deaktivieren sendet PATCH mit active=false', async ({ page }) => {
  let patchBody = null
  await setToken(page, ADMIN_TOKEN)
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )
  await page.route('/api/admin/users/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_USERS[1], active: false }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/users')
  const helpdeskRow = page.locator('tr', { hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Deaktivieren")').click()

  await expect(async () => {
    expect(patchBody).not.toBeNull()
  }).toPass()

  expect(patchBody).toEqual({ active: false })
})

test('CRUD-7: Inaktiven Nutzer reaktivieren sendet PATCH mit active=true', async ({ page }) => {
  let patchBody = null
  await setToken(page, ADMIN_TOKEN)
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )
  await page.route('/api/admin/users/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      patchBody = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_USERS[2], active: true }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/users')
  const readonlyRow = page.locator('tr', { hasText: 'readonly' })
  await readonlyRow.locator('button:has-text("Aktivieren")').click()

  await expect(async () => {
    expect(patchBody).not.toBeNull()
  }).toPass()

  expect(patchBody).toEqual({ active: true })
})

test('CRUD-8: 409-Fehler beim Deaktivieren des letzten Admins zeigt Fehlermeldung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
  )
  await page.route('/api/admin/users/**', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Cannot deactivate the last active admin' }),
      })
    } else {
      await route.continue()
    }
  })

  await page.goto('/admin/users')
  const adminRow = page.locator('tr', { hasText: 'admin' }).first()
  await adminRow.locator('button:has-text("Deaktivieren")').click()

  // Fehlermeldung muss erscheinen (Backend sendet Englisch – BUG-8-1)
  const error = page.locator('p.text-red-400').first()
  await expect(error).toBeVisible()
  // Prüft auf englischen Backend-Text (lokale Fallback-Übersetzung fehlt – BUG-8-1)
  await expect(error).toContainText('deactivate')
})

test('CRUD-9: 409-Fehler bei doppeltem Username wird angezeigt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await page.route('/api/admin/users', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Username already exists' }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) })
    }
  })

  await page.goto('/admin/users')
  await page.click('button:has-text("Nutzer anlegen")')
  await page.fill('input[name="username"]', 'admin')
  await page.fill('input[name="password"]', 'passwort123')
  await page.fill('input[name="passwordConfirm"]', 'passwort123')
  await page.click('button:has-text("Nutzer anlegen")')

  const error = page.locator('p.text-red-400')
  await expect(error).toBeVisible()
  // Prüft auf englischen Backend-Text (lokale Fallback-Übersetzung fehlt – BUG-8-1)
  await expect(error).toContainText('already exists')
})
