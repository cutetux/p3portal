// p3portal.org
// PROJ-109: "Angemeldet bleiben" – Opt-in Login-Persistenz (localStorage vs sessionStorage).
// Login-Backend wird gemockt; getestet wird die Persistenz-Wahl im Browser.
import { test, expect } from '@playwright/test'

// Minimales, parsebares JWT – Payload ist base64 von
// {sub:'qa',role:'admin',auth_type:'local',exp:9999999999} (vorab berechnet,
// damit der Test ohne Buffer/btoa auskommt). Reicht für parseJwtPayload().
const PAYLOAD = 'eyJzdWIiOiJxYSIsInJvbGUiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwiZXhwIjo5OTk5OTk5OTk5fQ=='
const JWT = `eyJhbGciOiJIUzI1NiJ9.${PAYLOAD}.sig`

async function mockLogin(page) {
  // LIFO: Catch-All zuerst, spezifische Routen danach.
  // WICHTIG: an den Host ankern (localhost:PORT/api/…), sonst fängt der Catch-All
  // auch Vite-Modulpfade wie /src/api/client.js ab → App bootet nicht.
  await page.route(/localhost:\d+\/api\//, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  )
  await page.route(/localhost:\d+\/api\/setup\/features/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ proxmox_login_enabled: false }),
    }),
  )
  await page.route(/localhost:\d+\/api\/auth\/login\/local/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: JWT, token_type: 'bearer' }),
    }),
  )
}

async function doLogin(page, { remember }) {
  await page.goto('/login')
  await page.locator('input[name="username"]').fill('qa')
  await page.locator('input[name="password"]').fill('secret')
  if (remember) await page.locator('input[name="remember"]').check()
  await page.getByRole('button', { name: /Anmelden|Sign in/ }).click()
}

test.describe('PROJ-109 – Angemeldet bleiben', () => {
  test.beforeEach(async ({ page }) => {
    await mockLogin(page)
  })

  // AC-1: Checkbox vorhanden, Default aus
  test('AC-1: Checkbox vorhanden und standardmäßig NICHT angehakt', async ({ page }) => {
    await page.goto('/login')
    const cb = page.locator('input[name="remember"]')
    await expect(cb).toBeVisible()
    await expect(cb).not.toBeChecked()
  })

  // AC-2: Haken an → Token in localStorage, nicht in sessionStorage
  test('AC-2: mit Haken landet der Token in localStorage (nicht sessionStorage)', async ({ page }) => {
    await doLogin(page, { remember: true })
    await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBe(JWT)
    expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()
  })

  // AC-3: Haken aus → Token in sessionStorage, nicht in localStorage
  test('AC-3: ohne Haken bleibt der Token in sessionStorage (Default)', async ({ page }) => {
    await doLogin(page, { remember: false })
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token'))).toBe(JWT)
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull()
  })
})
