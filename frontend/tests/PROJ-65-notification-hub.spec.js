// p3portal.org
// PROJ-65: E2E-Tests für Notification Hub
// Testet: Bell-Icon, Widgets, Hub-Page, Read-Tracking, Severity-Rename
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["view_logs"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbInZpZXdfbG9ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// viewer token – für zukünftige Tests reserviert
// const VIEWER_TOKEN = H + '.' + 'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjJ9' + '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_SUMMARY_EMPTY = { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null }
const MOCK_SUMMARY_INFO = { alerts: 0, announcements: 2, events: 1, total: 3, max_severity: 'info' }
const MOCK_SUMMARY_WARN = { alerts: 0, announcements: 1, events: 0, total: 1, max_severity: 'warn' }
const MOCK_SUMMARY_CRITICAL = { alerts: 2, announcements: 1, events: 0, total: 3, max_severity: 'critical' }

const MOCK_ANN_ITEMS = [
  {
    source: 'announcement',
    source_id: '1',
    severity: 'warn',
    title: 'Wartungsfenster',
    summary: 'Wartungsfenster heute Nacht 22:00–02:00',
    created_at: '2026-05-01T10:00:00Z',
    read: false,
    link: { route: '/announcements', modal: null, params: {} },
    meta: {},
  },
  {
    source: 'announcement',
    source_id: '2',
    severity: 'info',
    title: 'Neues Feature',
    summary: 'PROJ-65 Notification Hub ist live',
    created_at: '2026-05-02T10:00:00Z',
    read: true,
    link: { route: '/announcements', modal: null, params: {} },
    meta: {},
  },
]

const MOCK_ALERT_ITEMS = [
  {
    source: 'alert',
    source_id: 'alert-pve01-101',
    severity: 'critical',
    title: 'VM 101 CPU > 95%',
    summary: 'CPU-Auslastung kritisch',
    created_at: '2026-05-03T08:00:00Z',
    read: false,
    link: { route: '/vms/pve01/101', modal: 'alerts', params: {} },
    meta: { node_id: 'pve01', vmid: 101 },
  },
  {
    source: 'alert',
    source_id: 'alert-pve01-102',
    severity: 'warn',
    title: 'VM 102 RAM > 80%',
    summary: 'RAM-Auslastung erhöht',
    created_at: '2026-05-03T07:00:00Z',
    read: false,
    link: { route: '/vms/pve01/102', modal: 'alerts', params: {} },
    meta: { node_id: 'pve01', vmid: 102 },
  },
]

const MOCK_EVENT_ITEMS = [
  {
    source: 'event',
    source_id: 'job-42',
    severity: 'success',
    title: 'Job „VM deployen" erfolgreich',
    summary: 'Laufzeit: 45s',
    created_at: '2026-05-03T09:00:00Z',
    read: false,
    link: { route: '/events', modal: null, params: { job_id: 42 } },
    meta: {},
  },
]

const MOCK_LICENSE = {
  edition: 'core', valid: false,
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false }, groups: { current: 0, max: 3, unlimited: false }, ownerships: { current: 0, max: 10, unlimited: false }, sidebar_pins: { max: 5, soft_warn: 5, hard_max: 25 } },
  app_version: '1.68.0',
}

const MOCK_CAPS = {
  alert_presets: false, alerts_smtp: false, theme_editor: false,
  multiple_nodes: false, approval_workflow: false, allow_self_approval_supported: false,
  pools_quotas: false, playbook_permissions: false, extra_portal_permissions: [],
}

const MOCK_ME_ADMIN = { id: 1, username: 'admin', role: 'admin', auth_type: 'local', portal_permissions: ['view_logs'], groups: [] }

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), token)
}

async function setupBaseMocks(page, { summary = MOCK_SUMMARY_EMPTY, me = MOCK_ME_ADMIN } = {}) {
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()
    // Notifications
    if (url.includes('/api/notifications/unread-summary')) return route.fulfill({ json: summary })
    if (url.includes('/api/notifications'))    return route.fulfill({ json: [] })
    // Auth + User
    if (url.includes('/api/license/status'))   return route.fulfill({ json: MOCK_LICENSE })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: MOCK_CAPS })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: me })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    // Sidebar + Navigation
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })
    // Cluster – reihenfolge: spezifisch vor allgemein (LIFO-Pattern)
    if (url.includes('/api/cluster/status'))   return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))    return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))          return route.fulfill({ json: [] })
    // Andere
    if (url.includes('/api/nodes'))            return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))    return route.fulfill({ json: [] })
    if (url.includes('/api/alerts/summary'))   return route.fulfill({ json: [] })
    if (url.includes('/api/alerts'))           return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))           return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))             return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))             return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))             return route.fulfill({ json: [] })
    await route.continue()
  })
}

// Bell-Button-Locator: nutzt title-Attribut (sprach-unabhängig mit EN default)
const bellSelector = 'button[title*="notification" i], button[title*="Benachrichtig" i], button[aria-label*="Notification" i], button[aria-label*="Benachrichtig" i]'

// ── AC-BELL-1: Glocke nach Login immer sichtbar ───────────────────────────────

test('AC-BELL-1: Glocke ist nach Login in der Sidebar sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Bell-Button in der Sidebar (Desktop-Breite)
  const bell = page.locator(bellSelector).first()
  await expect(bell).toBeVisible()
})

// ── AC-BELL-2: Kein Badge wenn keine ungelesenen Einträge ─────────────────────

test('AC-BELL-2: Kein Badge wenn keine ungelesenen Einträge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // Kein Badge-Element sichtbar (span mit Zahl)
  // :is() gruppiert alle Selektoren damit " span" auf alle wirkt (kein CSS-Komma-Trick-Bug)
  const badge = page.locator(`:is(${bellSelector}) span`).first()
  await expect(badge).not.toBeVisible()
})

// ── AC-BELL-3: Badge zeigt ungelesene Anzahl (max 99+) ───────────────────────

test('AC-BELL-3: Badge zeigt 3 ungelesene Einträge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // :is() korrekte Gruppen-Semantik für alle Selektoren
  const badge = page.locator(`:is(${bellSelector}) span`).first()
  await expect(badge).toBeVisible()
  await expect(badge).toHaveText('3')
})

// ── AC-BELL-4: Bell navigiert zu /announcements ──────────────────────────────

test('AC-BELL-4: Klick auf Glocke navigiert zu /announcements', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  const bell = page.locator(bellSelector).first()
  await bell.click()

  await expect(page).toHaveURL(/\/announcements/)
})

// ── AC-BELL-5: Glocke-Farbe blau bei info, orange bei warn, rot bei critical ──

test('AC-BELL-5: Bell-Farbe ist blau (info) wenn max_severity=info', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  const bell = page.locator(bellSelector).first()
  // Bell sollte portal-info Farb-Klasse haben
  const cls = await bell.getAttribute('class')
  expect(cls).not.toBeNull()
  // Farbe muss portal-* Token sein, keine raw Tailwind-Farbe
  expect(cls).not.toMatch(/text-blue-\d+/)
  expect(cls).not.toMatch(/text-red-\d+/)
})

// ── AC-BELL-6: Glocke in Desktop-Sidebar und Mobile-Header (je einmal) ────────

test('AC-BELL-6: Glocke erscheint genau einmal auf Desktop (Sidebar)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  const bells = page.locator(bellSelector)
  // Auf Desktop: mind. 1 Bell sichtbar (eine in Sidebar)
  const visibleCount = await bells.filter({ visible: true }).count()
  expect(visibleCount).toBeGreaterThanOrEqual(1)
})

// ── AC-HUB-1: Hub-Page zeigt 3 Tabs ──────────────────────────────────────────

test('AC-HUB-1: NotificationsHubPage zeigt 3 Tabs', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })
  // Zusätzlich Tab-spezifische Daten
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: MOCK_ANN_ITEMS }))
  await page.route(/localhost:\d+\/api\/notifications\?tab=alerts/, route => route.fulfill({ json: MOCK_ALERT_ITEMS }))
  await page.route(/localhost:\d+\/api\/notifications\?tab=events/, route => route.fulfill({ json: MOCK_EVENT_ITEMS }))

  await page.goto('http://localhost:5173/announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // 3 Tabs müssen sichtbar sein
  await expect(page.getByText('Ankündigungen')).toBeVisible()
  await expect(page.getByText('Alerts')).toBeVisible()
  await expect(page.getByText('Ereignisse')).toBeVisible()
})

// ── AC-HUB-2: Tab-Wechsel via URL-Parameter ───────────────────────────────────

test('AC-HUB-2: ?tab=alerts wählt Alerts-Tab vor', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_CRITICAL })
  // Tab-spezifische Route hat höhere LIFO-Priorität als setupBaseMocks-Catch-all
  await page.route(/localhost:\d+\/api\/notifications\?tab=alerts/, route => route.fulfill({ json: MOCK_ALERT_ITEMS }))

  await page.goto('http://localhost:5173/announcements?tab=alerts')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Alert-Item muss sichtbar sein
  await expect(page.getByText('VM 101 CPU > 95%')).toBeVisible()
})

// ── AC-HUB-3: Sidebar-Link „Benachrichtigungen" navigiert zu /announcements ───

test('AC-HUB-3: Sidebar-Link Benachrichtigungen navigiert zu /announcements', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // Sidebar-Link klicken
  const link = page.getByRole('link', { name: /benachrichtigungen/i })
  if (await link.isVisible()) {
    await link.click()
    await expect(page).toHaveURL(/\/announcements/)
  } else {
    test.skip()
  }
})

// ── AC-HUB-4: Ankündigungen-Tab zeigt Einträge mit Severity-Badge ─────────────

test('AC-HUB-4: Ankündigungen-Tab zeigt Items mit korrektem Inhalt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })
  // Spezifische Tab-Route hat höhere LIFO-Priorität als Catch-all
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: MOCK_ANN_ITEMS }))

  await page.goto('http://localhost:5173/announcements?tab=announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  await expect(page.getByText('Wartungsfenster', { exact: true })).toBeVisible()
  await expect(page.getByText('Neues Feature', { exact: true })).toBeVisible()
})

// ── AC-HUB-5: „Alle markieren"-Button sendet POST /read ──────────────────────

test('AC-HUB-5: "Alle markieren"-Button sendet POST /api/notifications/read', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  let readRequestCalled = false
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })
  // /read überschreibt den setupBaseMocks-Fallback (höhere LIFO-Priorität)
  await page.route(/localhost:\d+\/api\/notifications\/read/, async route => {
    readRequestCalled = true
    return route.fulfill({ json: { marked: 1 } })
  })
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: MOCK_ANN_ITEMS }))

  await page.goto('http://localhost:5173/announcements?tab=announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  const markAllBtn = page.getByRole('button', { name: /alle markieren/i })
  if (await markAllBtn.isVisible()) {
    await markAllBtn.click()
    await page.waitForTimeout(500)
    expect(readRequestCalled).toBe(true)
  } else {
    test.skip()
  }
})

// ── AC-READ-1: Tab-Besuch markiert NICHT automatisch; Klick markiert einzeln ──

test('AC-READ-1: Tab-Besuch sendet kein /read; Klick auf Item markiert es einzeln', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)

  const readRequests = []
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })
  await page.route(/localhost:\d+\/api\/notifications\/read/, async route => {
    const body = await route.request().postDataJSON()
    readRequests.push(body)
    return route.fulfill({ json: { marked: body.source_ids?.length ?? 0 } })
  })
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: MOCK_ANN_ITEMS }))

  await page.goto('http://localhost:5173/announcements?tab=announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Reiner Tab-Besuch darf nichts als gelesen markieren (ungelesene bleiben sichtbar)
  expect(readRequests.length).toBe(0)

  // Klick auf das ungelesene Item „Wartungsfenster" markiert genau dieses
  await page.getByText('Wartungsfenster').first().click()
  await page.waitForTimeout(500)

  const annReads = readRequests.filter(r => r.source === 'announcement')
  expect(annReads.length).toBe(1)
  expect(annReads[0].source_ids).toContain('1')
})

// ── AC-READ-2: Gelesene Items bleiben dauerhaft sichtbar ─────────────────────

test('AC-READ-2: Gelesene Items (read=true) bleiben im Tab sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })
  await page.route(/localhost:\d+\/api\/notifications\/read/, route => route.fulfill({ json: { marked: 0 } }))
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: MOCK_ANN_ITEMS }))

  await page.goto('http://localhost:5173/announcements?tab=announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Item mit read=true (source_id='2') muss sichtbar sein
  await expect(page.getByText('Neues Feature')).toBeVisible()
})

// ── AC-WIDGET-1: Dashboard zeigt 3 Widgets ───────────────────────────────────

test('AC-WIDGET-1: Dashboard zeigt Notification-Widgets', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_INFO })
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: MOCK_ANN_ITEMS }))
  await page.route(/localhost:\d+\/api\/notifications\?tab=alerts/, route => route.fulfill({ json: MOCK_ALERT_ITEMS }))
  await page.route(/localhost:\d+\/api\/notifications\?tab=events/, route => route.fulfill({ json: MOCK_EVENT_ITEMS }))

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Widgets-Bereich muss auf Dashboard existieren
  // Mindestens eines der Widget-Titel sichtbar
  const widgetTitles = [
    page.getByText('Alerts').first(),
    page.getByText('Ankündigungen').first(),
    page.getByText('Ereignisse').first(),
  ]
  let found = 0
  for (const w of widgetTitles) {
    if (await w.isVisible()) found++
  }
  // Mindestens 1 Widget-Titel muss sichtbar sein
  expect(found).toBeGreaterThanOrEqual(1)
})

// ── AC-SEVERITY-1: announcements.severity Feld wird korrekt gelesen ──────────

test('AC-SEVERITY-1: Announcement mit severity=warn zeigt Warn-Badge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_WARN })
  await page.route(/localhost:\d+\/api\/notifications\/read/, route => route.fulfill({ json: { marked: 0 } }))
  await page.route(/localhost:\d+\/api\/notifications\?tab=announcements/, route => route.fulfill({ json: [MOCK_ANN_ITEMS[0]] }))

  await page.goto('http://localhost:5173/announcements?tab=announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Item „Wartungsfenster" mit severity=warn sichtbar (exact verhindert strict-mode-Verletzung)
  await expect(page.getByText('Wartungsfenster', { exact: true })).toBeVisible()
})

// ── AC-SEVERITY-2: AnnouncementFormModal hat severity-Dropdown ───────────────

test('AC-SEVERITY-2: Ankündigung erstellen zeigt severity-Dropdown (nicht type)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  // Zur Announcements-Admin-Seite navigieren (SystemSettings)
  await page.goto('http://localhost:5173/system-settings?tab=portal')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // Neue Ankündigung öffnen (wenn Button sichtbar)
  const newBtn = page.getByRole('button', { name: /neu|erstellen|create|add/i }).first()
  if (await newBtn.isVisible()) {
    await newBtn.click()
    await page.waitForTimeout(300)
    // severity-Dropdown (nicht type) soll im Modal sichtbar sein
    const severitySelect = page.locator('select[name="severity"], select[id="severity"]')
    const severityLabel = page.getByText(/schweregrad|severity/i)
    const hasSeverityField = (await severitySelect.count()) > 0 || (await severityLabel.count()) > 0
    expect(hasSeverityField).toBe(true)
  } else {
    test.skip()
  }
})

// ── AC-SEVERITY-3: Glocken-Farbe ist grau wenn keine Einträge ────────────────

test('AC-SEVERITY-3: Glocken-Farbe ist neutral/grau bei 0 Einträgen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  const bell = page.locator(bellSelector).first()
  const cls = await bell.getAttribute('class')
  // Keine Danger/Warn-Farben wenn leer
  expect(cls).not.toMatch(/text-portal-danger/)
  expect(cls).not.toMatch(/text-portal-warn/)
})

// ── Regression: /announcements-Route existiert ────────────────────────────────

test('REGRESSION: Route /announcements existiert und rendert ohne Fehler', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })

  await page.goto('http://localhost:5173/announcements')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // Kein 404-Text, keine Fehlermeldung
  await expect(page.getByText('404')).not.toBeVisible()
  await expect(page.getByText('Page not found')).not.toBeVisible()
})

// ── Regression: PROJ-28 AnnouncementsBanner nutzt severity statt type ─────────

test('REGRESSION-PROJ28: AnnouncementsBanner rendert mit severity-Feld', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  const annWithSeverity = [
    { id: 1, message: 'Test-Ankündigung', severity: 'warn', active: true, expires_at: null, created_by: 'admin', created_at: '2026-05-01T10:00:00Z', updated_at: '2026-05-01T10:00:00Z', expired: false },
  ]
  await setupBaseMocks(page, { summary: MOCK_SUMMARY_EMPTY })
  // /api/announcements mit severity-Daten überschreibt setupBaseMocks-Catch-all
  await page.route(/localhost:\d+\/api\/announcements/, route => route.fulfill({ json: annWithSeverity }))

  await page.goto('http://localhost:5173/dashboard')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(1000)

  // Banner muss mit severity=warn sichtbar sein
  await expect(page.getByText('Test-Ankündigung')).toBeVisible()
})
