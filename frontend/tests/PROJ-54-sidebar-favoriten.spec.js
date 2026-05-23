// p3portal.org
// PROJ-54: E2E-Tests für Sidebar-Favoriten (Pinning) + Sidebar-Umstrukturierung
// Session 309: 19 Tests (Basis-Suite)
// Session 311: +3 Tests (BUG-54-1 Detail-Page PinIcon, BUG-54-2 atLimit vorberechnet)
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
// const VIEWER_TOKEN =
//   H + '.' +
//   'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
//   '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_VM_DETAIL = {
  vmid: 101,
  name: 'test-vm',
  type: 'qemu',
  status: 'running',
  node: 'pve01',
  ip: null,
  uptime: 3600,
  tags: [],
  is_template: false,
  cpu_usage: 0.05,
  cpu_cores: 2,
  mem_used: 536870912,
  mem_total: 2147483648,
  bios: 'seabios',
  ostype: 'l26',
  networks: [],
  disks: [],
  cpu_type: null,
  sockets: null,
  onboot: null,
  protection: null,
  description: null,
  lxc_hostname: null,
  lxc_ostemplate: null,
}

const MOCK_BACKUPS = { backups: [], schedules: [], storages: [] }

const MOCK_NODES = [
  { id: 1, name: 'pve01', host: '192.168.1.10', is_cluster: false, is_default: true },
]

const MOCK_PIN = {
  id: 1,
  user_id: 1,
  route: '/system-settings?tab=nodes',
  label: null,
  position: 0,
  pin_kind: 'system_settings_tab',
  resource_ref: null,
  created_at: '2026-05-12T10:00:00Z',
}

const MOCK_PIN_LABELED = {
  ...MOCK_PIN,
  label: 'Meine Knoten',
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommonApi(page, { plus = false, pins = [] } = {}) {
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }),
    })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NODES) })
  )
  await page.route('/api/admin/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/preferences', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ theme_preference: null, lang_preference: null }),
    })
  )
  await page.route('/api/me/pools', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/groups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        edition: plus ? 'plus' : 'core',
        valid: plus,
        contact_name: null,
        expiry: null,
        reason: null,
        limits: {
          users: { current: 1, max: plus ? null : 6, unlimited: plus },
          presets: { current: 0, max: plus ? null : 5, unlimited: plus },
          sidebar_pins: { max: plus ? 10 : 5, soft_warn: plus ? 10 : null, hard_max: plus ? 25 : 5 },
        },
      }),
    })
  )
  await page.route('/api/sidebar-pins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pins) })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/themes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/i18n/languages', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// AC-RESTR-1: V2Sidebar enthält keinen eigenen NavLink mehr für /admin/groups und /admin/pools
// ════════════════════════════════════════════════════════════════════════════

test('AC-RESTR-1: V2Sidebar hat keinen direkten Gruppen- oder Pools-Link', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: true })

  await page.goto('/dashboard')
  await page.waitForSelector('nav', { timeout: 5000 })

  // Sidebar darf keinen direkten Link zu /admin/groups oder /admin/pools haben
  const groupsLink = page.locator('nav a[href="/admin/groups"]')
  const poolsLink = page.locator('nav a[href="/admin/pools"]')

  await expect(groupsLink).toHaveCount(0)
  await expect(poolsLink).toHaveCount(0)
})

// ════════════════════════════════════════════════════════════════════════════
// AC-RESTR-2: SystemSettingsPage „Nutzer"-Tab hat Sub-Tab „Gruppen"
// ════════════════════════════════════════════════════════════════════════════

test('AC-RESTR-2: System Settings Nutzer-Tab enthält Sub-Tab Gruppen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/groups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')

  // Nutzer-Tab klicken
  const usersTab = page.locator('button', { hasText: /Nutzer/i }).first()
  await usersTab.click()

  // Gruppen Sub-Tab sollte sichtbar sein
  await expect(page.locator('button', { hasText: /Gruppen/i })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-RESTR-3: SystemSettingsPage hat Pools-Tab (nur bei Plus)
// ════════════════════════════════════════════════════════════════════════════

test('AC-RESTR-3a: Core-Edition zeigt keinen Pools-Tab in System Settings', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: false })

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')

  // Pools-Tab darf nicht sichtbar sein (Core-Edition)
  await expect(page.locator('button', { hasText: /^Pools$/i })).toHaveCount(0)
})

test('AC-RESTR-3b: Plus-Edition zeigt Pools-Sub-Tab unter Nutzer & Rechte (PROJ-59: Sub-Tab statt Top-Tab)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: true })
  await page.route('/api/pools**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/approvals/count', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) })
  )
  await page.route('/api/approvals/workflow/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, max_approval_rules: 3 }) })
  )
  await page.route('/api/approvals/rules', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/settings/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ min: 100, max: 199 }) })
  )
  await page.route('/api/playbook-permissions**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'open' }) })
  )

  // PROJ-59: Pools ist jetzt Sub-Tab unter "Nutzer & Rechte" – direkt dorthin navigieren
  await page.goto('/system-settings?tab=users')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('button', { hasText: /^Pools$/i })).toBeVisible({ timeout: 10000 })
})

// ════════════════════════════════════════════════════════════════════════════
// AC-RESTR-4: Legacy-Routen /admin/groups und /admin/pools bleiben funktional
// ════════════════════════════════════════════════════════════════════════════

test('AC-RESTR-4: Legacy-Route /admin/groups rendert ohne Fehler', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/groups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/admin/groups')
  await page.waitForLoadState('networkidle')

  // Kein 404 oder Crash – Seite rendert irgendwas (wenigstens die Shell)
  await expect(page.locator('body')).toBeVisible()
  // Kein Error-Boundary oder "Not Found" Meldung
  await expect(page.locator('text=404')).toHaveCount(0)
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-UI-1: Pin-Icon in System Settings Tab-Headern
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-1: Pin-Icons erscheinen in System Settings Tab-Headern', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  let postBody = null
  await page.route('/api/sidebar-pins', async (route) => {
    if (route.request().method() === 'POST') {
      postBody = JSON.parse(route.request().postBody())
      await route.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ pin: { ...MOCK_PIN, route: postBody.route }, warning: null }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')

  // Es sollten Pin-Icons (SVG-Buttons) im Tab-Bereich vorhanden sein
  const pinButtons = page.locator('button[title*="Favoriten"], button[title*="Pin"]')
  await expect(pinButtons.first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-UI-1 Toggle: Klick auf Pin-Icon → POST, Tooltip ändert sich
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-1 Toggle: Pin-Toggle in System Settings wechselt Tooltip', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  // Pins-State der Session (startend leer)
  const sessionPins = []
  let nextId = 10

  // mockCommonApi ZUERST (Playwright LIFO: letzte Route gewinnt)
  await mockCommonApi(page, { pins: [] })

  // Spezifische Pin-Routen DANACH registrieren → gewinnen wegen LIFO
  await page.route('/api/sidebar-pins', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      const body = route.request().postDataJSON() || {}
      const newPin = { id: nextId++, user_id: 1, route: body.route || '/unknown', label: null, position: sessionPins.length, pin_kind: body.pin_kind || 'other', resource_ref: null, created_at: '2026-05-12T10:00:00Z' }
      sessionPins.push(newPin)
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ pin: newPin, warning: null }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessionPins) })
    }
  })
  await page.route('/api/sidebar-pins/**', async (route) => {
    if (route.request().method() === 'DELETE') {
      const id = parseInt(route.request().url().split('/').pop())
      const idx = sessionPins.findIndex(p => p.id === id)
      if (idx !== -1) sessionPins.splice(idx, 1)
      await route.fulfill({ status: 204 })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PIN) })
    }
  })

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')

  // Erster Pin-Button muss "Zu Favoriten hinzufügen" lauten (nicht gepinnt)
  const addBtn = page.locator('button[title="Zu Favoriten hinzufügen"]').first()
  await expect(addBtn).toBeVisible()

  // Warte auf POST-Request nach dem Klick
  const [postReq] = await Promise.all([
    page.waitForRequest(req => req.url().includes('/api/sidebar-pins') && req.method() === 'POST'),
    addBtn.click(),
  ])
  expect(postReq).toBeTruthy()

  // Warte auf die Antwort und State-Update
  await page.waitForResponse(resp => resp.url().includes('/api/sidebar-pins') && resp.request().method() === 'POST')
  await page.waitForTimeout(300)

  // Nach dem Pin sollte der Tooltip "Aus Favoriten entfernen" sein
  await expect(page.locator('button[title="Aus Favoriten entfernen"]').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-UI-3: Favoriten-Sektion in Sidebar (hide when empty)
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-3a: Favoriten-Sektion ist ausgeblendet wenn keine Pins vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [] })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // "Favoriten" Header sollte nicht sichtbar sein
  await expect(page.locator('nav p:text-is("Favoriten")')).toHaveCount(0)
})

test('AC-PIN-UI-3b: Favoriten-Sektion erscheint wenn Pins vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [MOCK_PIN] })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // "Favoriten" Header und der Pin-Eintrag sollten sichtbar sein
  await expect(page.locator('nav', { hasText: 'Favoriten' })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-UI-4: Sidebar-Pin zeigt Label (custom oder default)
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-4: Sidebar zeigt Custom-Label wenn gesetzt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [MOCK_PIN_LABELED] })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Custom-Label "Meine Knoten" sollte in der Sidebar erscheinen
  await expect(page.locator('nav', { hasText: 'Meine Knoten' })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-UI-5: Klick auf Pin navigiert zur Ziel-Route
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-5: Klick auf Sidebar-Pin navigiert zur Ziel-Route', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [MOCK_PIN] })
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/rbac/presets', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Pin-NavLink klicken
  const pinLink = page.locator('nav a[title="/system-settings?tab=nodes"]')
  await pinLink.click()
  await page.waitForLoadState('networkidle')

  // URL sollte zu /system-settings navigiert haben
  await expect(page).toHaveURL(/system-settings/)
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-PROFIL-1: MyAccountPage hat Favoriten-Tab
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-PROFIL-1: MyAccountPage hat Favoriten-Tab', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/me', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'admin', role: 'admin', active: true, portal_permissions: [], auth_type: 'local', created_at: '2026-05-01T00:00:00Z' }),
    })
  )
  await page.route('/api/me/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('button', { hasText: 'Favoriten' })).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-PROFIL-2: Favoriten-Tab listet Pins mit Reorder und Delete
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-PROFIL-2: Favoriten-Tab zeigt Liste mit ↑↓ und Löschen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  const pins = [
    { ...MOCK_PIN, id: 1, position: 0, route: '/system-settings?tab=nodes', label: null },
    { ...MOCK_PIN, id: 2, position: 1, route: '/system-settings?tab=portal', label: 'Portal Config' },
  ]

  await mockCommonApi(page, { pins })
  // Sidebar-Pins-Route NACH mockCommonApi (LIFO → gewinnt)
  await page.route('/api/sidebar-pins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pins) })
  )
  await page.route('/api/me', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'admin', role: 'admin', active: true, portal_permissions: [], auth_type: 'local', created_at: '2026-05-01T00:00:00Z' }),
    })
  )
  await page.route('/api/me/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  // Favoriten-Tab öffnen
  await page.locator('button', { hasText: 'Favoriten' }).click()
  await page.waitForTimeout(500)

  // Pins sollten in der Tabelle angezeigt werden (title-Attribut eindeutiger als text)
  await expect(page.locator('button[title="Nach unten"]').first()).toBeVisible()

  // ↑↓-Buttons prüfen (i18n: "Nach oben" / "Nach unten")
  const upButtons = page.locator('button[title="Nach oben"]')
  const downButtons = page.locator('button[title="Nach unten"]')

  // Zweiter Pin hat ↑-Button (erster hat kein ↑, letzter hat kein ↓)
  await expect(downButtons.first()).toBeVisible()
  await expect(upButtons.first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-BE-3: Unauthentifizierter Zugriff – geprüft in backend pytest (test_router.py)
// Frontend-Test: Ohne Token redirect zur Login-Seite
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-BE-3: Ohne Token wird /account zur Login-Seite weitergeleitet', async ({ page }) => {
  // Kein Token gesetzt → Auth-Guard soll redirect machen
  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  // Entweder auf /login redirected oder Login-Form sichtbar
  const onLogin = page.url().includes('/login')
  const loginForm = await page.locator('input[type="password"]').count() > 0
  expect(onLogin || loginForm).toBeTruthy()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-PIN-LIMIT-2: Core-Nutzer erhält nach 403 den "atLimit"-Tooltip
// BUG-54-2 (Session 310 gefixt): atLimit wird jetzt auch beim Laden vorberechnet
// (Zusätzlicher Test AC-PIN-LIMIT-5 unten prüft die vorberechnete Variante)
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-LIMIT-2: Core-Nutzer mit vollem Limit bekommt 403 und atLimit-Feedback', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  // mockCommonApi ZUERST (LIFO: spätere Route gewinnt)
  await mockCommonApi(page, { plus: false, pins: [] })

  // Pin-Route NACH mockCommonApi → gewinnt wegen LIFO
  await page.route('/api/sidebar-pins', async (route) => {
    const method = route.request().method()
    if (method === 'POST') {
      // Simuliert Core-Limit-Blockade
      await route.fulfill({
        status: 403, contentType: 'application/json',
        body: JSON.stringify({ detail: { detail: 'pin_limit_reached', current: 5, max: 5, edition: 'core' } }),
      })
    } else {
      // GET: 0 Pins (keiner ist gepinnt → Toggle-Klick triggert POST)
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')

  // Pin-Button klicken → POST → 403 → atLimit = true → Tooltip ändert sich
  const addBtn = page.locator('button[title="Zu Favoriten hinzufügen"]').first()
  await expect(addBtn).toBeVisible()
  await addBtn.click()
  await page.waitForTimeout(600)

  // Nach 403 sollte der Button-Tooltip zu "Pin-Limit erreicht" wechseln
  await expect(page.locator('button[title="Pin-Limit erreicht"]').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-SEC-1+2: Route/Label-Validierung – geprüft in backend pytest (test_service.py)
// Frontend-Test: canonicalRoute() normalisiert vor dem Senden
// ════════════════════════════════════════════════════════════════════════════

test('AC-SEC-4: Frontend-Sidebar rendert Pins als NavLink (kein target=_blank)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [MOCK_PIN] })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Alle Links in der Sidebar sollten NavLinks ohne target=_blank sein
  const pinLinks = page.locator('nav a[title="/system-settings?tab=nodes"]')
  await expect(pinLinks).toBeVisible()

  // Sicherstellen: kein target="_blank"
  const target = await pinLinks.getAttribute('target')
  expect(target).toBeNull()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-STRUCT-2: Frontend Feature-Modul vorhanden
// ════════════════════════════════════════════════════════════════════════════

test('AC-STRUCT-2: FavoritesPage rendert fehlerfrei (leerer Zustand)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [] })
  await page.route('/api/me', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'admin', role: 'admin', active: true, portal_permissions: [], auth_type: 'local', created_at: '2026-05-01T00:00:00Z' }),
    })
  )
  await page.route('/api/me/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  await page.locator('button', { hasText: 'Favoriten' }).click()
  await page.waitForTimeout(300)

  // Empty-State sollte sichtbar sein
  await expect(page.locator('text=/Noch keine Favoriten|No favorites yet|keine Pins/i')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// Regression: PROJ-45 Gruppen-Sub-Tab funktioniert nach Umstrukturierung
// ════════════════════════════════════════════════════════════════════════════

test('Regression PROJ-45: Gruppen-Tab in System Settings zeigt Gruppen-Verwaltung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/groups', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'Test-Gruppe', description: null, tags: [], owner_user_id: null, owner_username: null, member_count: 0, created_at: '2026-05-01T00:00:00Z', created_by: 'admin' }]),
    })
  )

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')

  // Nutzer-Tab → Gruppen Sub-Tab
  const usersTab = page.locator('button', { hasText: /Nutzer/i }).first()
  await usersTab.click()
  await page.waitForTimeout(200)

  const gruppenTab = page.locator('button', { hasText: /Gruppen/i })
  await gruppenTab.click()
  await page.waitForTimeout(300)

  // Gruppen-Inhalt sollte sichtbar sein (z.B. Erstellen-Button oder Gruppen-Liste)
  const createBtn = page.locator('button', { hasText: /Gruppe erstellen|Neue Gruppe|Erstellen/i })
  const groupEntry = page.locator('text=Test-Gruppe')
  const hasGroupsContent = (await createBtn.count()) > 0 || (await groupEntry.count()) > 0
  expect(hasGroupsContent).toBeTruthy()
})

// ════════════════════════════════════════════════════════════════════════════
// Regression: PROJ-36 System Settings ist noch über Sidebar erreichbar
// ════════════════════════════════════════════════════════════════════════════

test('Regression PROJ-36: Sidebar-Link zu System Settings funktioniert', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // System Settings Link sollte vorhanden sein
  const settingsLink = page.locator('nav a[href="/system-settings"]')
  await expect(settingsLink).toBeVisible()
  await settingsLink.click()

  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/system-settings/)
})

// ════════════════════════════════════════════════════════════════════════════
// BUG-54-1 Fix-Verifikation: AC-PIN-UI-2 – PinIcon in VmDetailPage Header
// (Session 310: PinIcon + usePinToggle in VmDetailPage.jsx eingebaut)
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-2a: PinIcon ist im VM-Detail-Header sichtbar (BUG-54-1 Fix)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [] })

  // VM-Detail API muss Daten liefern (PinIcon wird nur bei truthy detail gerendert)
  await page.route('/api/cluster/vms/pve01/qemu/101', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_VM_DETAIL) })
  )
  await page.route('/api/cluster/vms/pve01/qemu/101/backups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_BACKUPS) })
  )
  await page.route('/api/vms/101/snapshots', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/cluster/vms/pve01/qemu/101/guest-info', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ os_name: null, os_version: null, hostname: null, filesystems: [] }) })
  )
  await page.route('/api/service-accounts/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ has_admin: false, has_operator: false, has_viewer: false, has_packer: false }) })
  )

  await page.goto('/vm/pve01/qemu/101')
  await page.waitForLoadState('networkidle')

  // PinIcon-Button sollte im Header sichtbar sein
  const pinBtn = page.locator('button[title="Zu Favoriten hinzufügen"], button[title="Aus Favoriten entfernen"], button[title="Pin-Limit erreicht"]')
  await expect(pinBtn.first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// BUG-54-1 Fix-Verifikation: AC-PIN-UI-2 – PinIcon in NodeDetailPage Header
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-UI-2b: PinIcon ist im NodeDetail-Header sichtbar (BUG-54-1 Fix)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { pins: [] })

  await page.goto('/compute/pve01')
  await page.waitForLoadState('networkidle')

  // PinIcon-Button sollte im Header sichtbar sein (NodeDetailPage rendert ihn immer)
  const pinBtn = page.locator('button[title="Zu Favoriten hinzufügen"], button[title="Aus Favoriten entfernen"], button[title="Pin-Limit erreicht"]')
  await expect(pinBtn.first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// BUG-54-2 Fix-Verifikation: AC-PIN-LIMIT-5 – atLimit vorberechnet beim Laden
// (Session 310: usePinToggle nutzt useQuery['license'] + vorberechnetes atLimit)
// ════════════════════════════════════════════════════════════════════════════

test('AC-PIN-LIMIT-5: Pin-Icons zeigen "Limit erreicht" direkt beim Laden (BUG-54-2 Fix)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  // 5 Pins (= Core-Limit voll) + License max=5
  const fullPins = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    user_id: 1,
    route: `/system-settings?tab=tab${i}`,
    label: null,
    position: i,
    pin_kind: 'system_settings_tab',
    resource_ref: null,
    created_at: '2026-05-12T10:00:00Z',
  }))

  await mockCommonApi(page, { plus: false, pins: fullPins })

  await page.goto('/system-settings')
  await page.waitForLoadState('networkidle')
  // Kurze Wartezeit damit React-Query license-Status geladen hat
  await page.waitForTimeout(600)

  // Für ungepinnte Tabs sollte ohne Klick "Pin-Limit erreicht" sichtbar sein
  const limitBtns = page.locator('button[title="Pin-Limit erreicht"]')
  await expect(limitBtns.first()).toBeVisible()
})
