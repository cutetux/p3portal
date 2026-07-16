// p3portal.org
// PROJ-106: E2E – Zwei-Faktor-Login-Flow, Zwangs-Enrollment, Enrollment-Assistent.
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToken(payload) {
  const b64 = (o) => btoa(JSON.stringify(o))
  const header = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ exp: 9999999999, ...payload })
  return `${header}.${body}.fake-sig`
}

const FULL_TOKEN = makeToken({ sub: 'alice', auth_type: 'local', role: 'operator', portal_permissions: [] })
const SETUP_TOKEN = makeToken({ sub: 'alice', auth_type: 'local', role: 'operator', must_setup_2fa: true, portal_permissions: [] })
const PRE_AUTH = makeToken({ sub: 'alice', stage: '2fa' })

const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h1v1H0z"/></svg>'

async function mockSetupFeatures(page) {
  await page.route('**/api/setup/features', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ proxmox_login_enabled: false }) }))
}

async function mockMe(page) {
  await page.route('**/api/me/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'alice', capabilities: {}, groups: [] }) }))
  await page.route(/\/api\/me$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'alice', auth_type: 'local', role: 'operator', must_change_pw: false, must_setup_2fa: false, last_login_at: null, last_login_ip: null, groups: [] }) }))
}

async function fillLocalLogin(page, { username = 'alice', password = 'AlicePass1234' } = {}) {
  await page.fill('input[name="username"]', username)
  await page.fill('input[name="password"]', password)
  await page.click('button[type="submit"]')
}

// ── AC-LOGIN-2: 2FA aktiv → Challenge statt Voll-Login ─────────────────────────

test('AC-LOGIN-2: 2FA aktiv → nach Passwort erscheint der Challenge-Schritt', async ({ page }) => {
  await mockSetupFeatures(page)
  await page.route(/\/api\/auth\/login\/local$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ two_factor_required: true, pre_auth_token: PRE_AUTH }) }))

  await page.goto('/login')
  await fillLocalLogin(page)

  // Challenge-Formular erscheint, kein Redirect
  await expect(page.locator('input[name="tfa_code"]')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBeNull() // noch KEIN Login
})

// ── AC-LOGIN-2/3: Code → Voll-Token → /dashboard ──────────────────────────────

test('AC-LOGIN-2: gültiger Code löst die Challenge → Login + /dashboard', async ({ page }) => {
  await mockSetupFeatures(page)
  await mockMe(page)
  await page.route(/\/api\/auth\/login\/local$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ two_factor_required: true, pre_auth_token: PRE_AUTH }) }))
  let sentBody
  await page.route(/\/api\/auth\/login\/2fa$/, (route) => {
    sentBody = route.request().postDataJSON()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: FULL_TOKEN, token_type: 'bearer' }) })
  })

  await page.goto('/login')
  await fillLocalLogin(page)
  await page.fill('input[name="tfa_code"]', '123456')
  await page.click('button[type="submit"]')

  await page.waitForURL('/dashboard')
  expect(sentBody).toEqual({ pre_auth_token: PRE_AUTH, code: '123456' })
  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBe(FULL_TOKEN)
})

// ── AC-LOGIN-4: Falscher Code → Fehler, bleibt auf Login ──────────────────────

test('AC-LOGIN-4: falscher Code zeigt Fehler und bleibt auf der Login-Seite', async ({ page }) => {
  await mockSetupFeatures(page)
  await page.route(/\/api\/auth\/login\/local$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ two_factor_required: true, pre_auth_token: PRE_AUTH }) }))
  await page.route(/\/api\/auth\/login\/2fa$/, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Authentication failed' }) }))

  await page.goto('/login')
  await fillLocalLogin(page)
  await page.fill('input[name="tfa_code"]', '000000')
  await page.click('button[type="submit"]')

  await expect(page.locator('p.text-portal-danger')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  const token = await page.evaluate(() => sessionStorage.getItem('token'))
  expect(token).toBeNull()
})

// ── Challenge abbrechen → zurück zum Login-Formular ───────────────────────────

test('Challenge-Abbruch kehrt zum Passwort-Formular zurück', async ({ page }) => {
  await mockSetupFeatures(page)
  await page.route(/\/api\/auth\/login\/local$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ two_factor_required: true, pre_auth_token: PRE_AUTH }) }))

  await page.goto('/login')
  await fillLocalLogin(page)
  await expect(page.locator('input[name="tfa_code"]')).toBeVisible()
  await page.click('button:has-text("Abbrechen")')
  await expect(page.locator('input[name="username"]')).toBeVisible()
  await expect(page.locator('input[name="tfa_code"]')).toHaveCount(0)
})

// ── AC-ENF-3: must_setup_2fa-Token → Redirect /setup-2fa ──────────────────────

test('AC-ENF-3: must_setup_2fa erzwingt Redirect auf /setup-2fa', async ({ page }) => {
  await mockSetupFeatures(page)
  await mockMe(page)
  await page.route(/\/api\/me\/2fa$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, pending: false, enforced: true }) }))

  await page.addInitScript((tok) => { sessionStorage.setItem('token', tok) }, SETUP_TOKEN)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/setup-2fa/)
})

// ── AC-ENR-1..3: Enrollment-Assistent auf der Zwangs-Seite ────────────────────

test('AC-ENR-1..3: Enrollment zeigt QR + Verify → Recovery-Codes', async ({ page }) => {
  await mockSetupFeatures(page)
  await mockMe(page)
  await page.route(/\/api\/me\/2fa$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, pending: false, enforced: true }) }))
  await page.route(/\/api\/me\/2fa\/setup$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ secret: 'ABCDEFGHIJKLMNOP', otpauth_uri: 'otpauth://totp/P3%20Portal:alice?secret=ABCDEFGHIJKLMNOP', qr_svg: QR_SVG }) }))
  await page.route(/\/api\/me\/2fa\/verify$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recovery_codes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'], access_token: FULL_TOKEN }) }))

  await page.addInitScript((tok) => { sessionStorage.setItem('token', tok) }, SETUP_TOKEN)
  await page.goto('/setup-2fa')

  // Einrichten starten → QR (im weißen w-44-Container) + manueller Schlüssel
  await page.click('button:has-text("Einrichten")')
  await expect(page.locator('div.w-44 svg')).toBeVisible()
  await expect(page.getByText('ABCDEFGHIJKLMNOP')).toBeVisible()

  // Code bestätigen → Recovery-Codes
  await page.fill('input[inputmode="numeric"]', '123456')
  await page.click('button:has-text("Aktivieren")')
  await expect(page.getByText('AAAAA-BBBBB')).toBeVisible()
  await expect(page.getByText('CCCCC-DDDDD')).toBeVisible()
})

// ── AC-ENR-5 / Status: aktives 2FA zeigt Status + Deaktivieren ────────────────

test('Status: aktives 2FA zeigt Aktiv-Badge (nicht enforced → Deaktivieren möglich)', async ({ page }) => {
  await mockSetupFeatures(page)
  await mockMe(page)
  await page.route(/\/api\/me\/2fa$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, pending: false, enforced: false }) }))

  await page.addInitScript((tok) => { sessionStorage.setItem('token', tok) }, FULL_TOKEN)
  await page.goto('/account?tab=konto&sub=sicherheit')
  await expect(page.getByText('Zwei-Faktor-Authentifizierung').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deaktivieren' })).toBeVisible()
})
