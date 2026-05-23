// p3portal.org
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ0ZXN0dXNlckBwYW0iLCJwcm94bW94X3VzZXIiOiJ0ZXN0dXNlckBwYW0iLCJleHAiOjk5OTk5OTk5OTl9.' +
  'fake-signature'

async function mockLoginSuccess(page) {
  await page.route('/api/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: FAKE_TOKEN, token_type: 'bearer' }),
    })
  )
}

async function mockLoginFail(page, status = 401) {
  await page.route('/api/auth/login', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ detail: status === 429 ? 'Too many login attempts – try again later' : 'Authentication failed' }),
    })
  )
}

async function mockPermissions(page) {
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ username: 'testuser@pam', capabilities: {}, groups: [] }),
    })
  )
}

async function fillAndSubmitLogin(page, { username = 'testuser', password = 'secret', realm = 'pam' } = {}) {
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.selectOption('select[name="realm"]', realm)
  await page.click('button[type="submit"]')
}

// ── AC1: Login form renders with username, password, realm fields ──────────────

test('AC1: Login-Formular hat username, password und realm-Felder', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('input[name="username"]')).toBeVisible()
  await expect(page.locator('input[name="password"]')).toBeVisible()
  await expect(page.locator('select[name="realm"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

// ── AC2: Login form sends correct JSON body ────────────────────────────────────

test('AC2: Login-Formular sendet username, password und realm an /api/auth/login', async ({ page }) => {
  let requestBody
  await page.route('/api/auth/login', async (route) => {
    requestBody = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: FAKE_TOKEN, token_type: 'bearer' }),
    })
  })
  await mockPermissions(page)

  await page.goto('/login')
  await fillAndSubmitLogin(page, { username: 'max', password: 'geheim', realm: 'pve' })

  await page.waitForURL('/dashboard')
  expect(requestBody).toEqual({ username: 'max', password: 'geheim', realm: 'pve' })
})

// ── AC3: Successful login → JWT in sessionStorage, redirect to /dashboard ──────

test('AC3: Erfolgreicher Login speichert JWT im sessionStorage und leitet zu /dashboard weiter', async ({ page }) => {
  await mockLoginSuccess(page)
  await mockPermissions(page)

  await page.goto('/login')
  await fillAndSubmitLogin(page)
  await page.waitForURL('/dashboard')

  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBe(FAKE_TOKEN)
})

// ── AC4: Wrong credentials → 401, generic error message shown ─────────────────

test('AC4: Falsche Credentials zeigen generische Fehlermeldung (kein Hinweis ob User oder PW)', async ({ page }) => {
  await mockLoginFail(page, 401)
  await page.goto('/login')
  await fillAndSubmitLogin(page, { username: 'wrong', password: 'wrong' })

  const error = page.locator('p.text-red-400')
  await expect(error).toBeVisible()
  await expect(error).toContainText('fehlgeschlagen')
  // Must not say ONLY the password is wrong or ONLY the username is wrong
  // Acceptable: "Benutzername oder Passwort falsch" (ambiguous – does not reveal which)
  const errorText = await error.textContent()
  const mentionsPassword = errorText.toLowerCase().includes('passwort')
  const mentionsUsername = errorText.toLowerCase().includes('benutzername') || errorText.toLowerCase().includes('username')
  // If it mentions password, it MUST also mention username (i.e. use "or" phrasing)
  if (mentionsPassword) {
    expect(mentionsUsername).toBe(true)
  }
  // Must still be on login page (no redirect)
  await expect(page).toHaveURL(/\/login/)
})

// ── AC5: Rate limit 429 → appropriate message ─────────────────────────────────

test('AC5: Rate-Limit-Fehler (429) zeigt Wartehinweis', async ({ page }) => {
  await mockLoginFail(page, 429)
  await page.goto('/login')
  await fillAndSubmitLogin(page)

  const error = page.locator('p.text-red-400')
  await expect(error).toBeVisible()
  await expect(error).toContainText('60')
})

// ── AC6: Protected route redirects to /login without JWT ──────────────────────

test('AC6: /dashboard ohne JWT leitet zu /login weiter', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

// ── AC7: PVEAuthCookie not accessible via document.cookie ─────────────────────

test('AC7: PVEAuthCookie ist nicht im Browser über document.cookie sichtbar', async ({ page }) => {
  await mockLoginSuccess(page)
  await mockPermissions(page)

  await page.goto('/login')
  await fillAndSubmitLogin(page)
  await page.waitForURL('/dashboard')

  const cookies = await page.evaluate(() => document.cookie)
  expect(cookies).not.toContain('PVEAuthCookie')
  expect(cookies).not.toContain('CSRFPreventionToken')
})

// ── AC8: Logout clears sessionStorage and redirects to /login ─────────────────

test('AC8: Logout löscht JWT aus sessionStorage und leitet zu /login', async ({ page }) => {
  await mockLoginSuccess(page)
  await mockPermissions(page)
  await page.route('/api/auth/logout', (route) =>
    route.fulfill({ status: 204, body: '' })
  )

  await page.goto('/login')
  await fillAndSubmitLogin(page)
  await page.waitForURL('/dashboard')

  // Find and click logout button
  await page.click('button:has-text("Logout"), button:has-text("Abmelden"), [data-testid="logout"]')
  await page.waitForURL('/login')

  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBeNull()
})

// ── AC9: Realm dropdown contains pam, pve, ldap, ad ──────────────────────────

test('AC9: Realm-Dropdown enthält pam, pve, ldap und ad', async ({ page }) => {
  await page.goto('/login')
  const options = await page.locator('select[name="realm"] option').allTextContents()
  const values = await page.locator('select[name="realm"] option').evaluateAll((els) => els.map((e) => e.value))
  // Check by value attribute (pam, pve, ldap, ad) as labels are human-readable
  expect(values).toContain('pam')
  expect(values).toContain('pve')
  expect(values).toContain('ldap')
  expect(values).toContain('ad')
  // Labels should be human-readable
  expect(options.some((o) => o.toLowerCase().includes('pam'))).toBe(true)
  expect(options.some((o) => o.toLowerCase().includes('proxmox') || o.toLowerCase().includes('pve'))).toBe(true)
  expect(options.some((o) => o.toLowerCase().includes('ldap'))).toBe(true)
  expect(options.some((o) => o.toLowerCase().includes('active') || o.toLowerCase().includes('ad'))).toBe(true)
})

// ── AC10: 502 Proxmox unreachable → appropriate error ────────────────────────

test('AC10: Proxmox nicht erreichbar (502) zeigt passende Fehlermeldung', async ({ page }) => {
  await page.route('/api/auth/login', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Could not reach Proxmox API' }),
    })
  )
  await page.goto('/login')
  await fillAndSubmitLogin(page)

  const error = page.locator('p.text-red-400')
  await expect(error).toBeVisible()
  await expect(error).toContainText('nicht erreichbar')
})
