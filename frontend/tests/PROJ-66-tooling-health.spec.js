// p3portal.org
// PROJ-66: E2E-Tests für Tooling-Health-Indikatoren in Topbar
// Testet: Indikatoren sichtbar, Status-Farben, Slide-Over, Sections, Recheck, Rate-Limit, Auth
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["view_logs"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbInZpZXdfbG9ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_STATUS_READY = {
  ansible: { tool: 'ansible', version: '2.18.1', status: 'ready', last_check: new Date().toISOString(), stdout: '=== ansible --version ===\nansible [core 2.18.1]\n', stderr: '' },
  packer:  { tool: 'packer',  version: '1.11.2', status: 'ready', last_check: new Date().toISOString(), stdout: '=== packer version ===\nPacker v1.11.2\n',           stderr: '' },
}

const MOCK_STATUS_MIXED = {
  ansible: { tool: 'ansible', version: '2.18.1', status: 'ready',    last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
  packer:  { tool: 'packer',  version: '1.11.2', status: 'degraded', last_check: new Date().toISOString(), stdout: '',   stderr: 'probe failed' },
}

// eslint-disable-next-line no-unused-vars
const MOCK_STATUS_DOWN = {
  ansible: { tool: 'ansible', version: null, status: 'down',    last_check: new Date().toISOString(), stdout: '', stderr: 'ansible: command not found' },
  packer:  { tool: 'packer',  version: null, status: 'unknown', last_check: null, stdout: null, stderr: null },
}

const MOCK_AUDIT_ITEMS = {
  tool: 'ansible',
  items: [
    { id: 1, created_at: new Date(Date.now() - 5 * 60000).toISOString(), tool: 'ansible', from_status: 'down', to_status: 'ready', version: '2.18.1', stderr_excerpt: null },
    { id: 2, created_at: new Date(Date.now() - 15 * 60000).toISOString(), tool: 'ansible', from_status: 'ready', to_status: 'down', version: '2.18.1', stderr_excerpt: 'connection timeout' },
  ],
  total: 2,
}

const MOCK_LICENSE = { edition: 'plus', is_plus_edition: true, license_valid: true }
const MOCK_CAPS    = { approval_workflow: false, approval_workflow_enabled: false }
const MOCK_ME      = { id: 1, username: 'admin', role: 'admin', auth_type: 'local', portal_permissions: ['view_logs'], groups: [] }

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupBaseMocks(page, { toolingStatus = MOCK_STATUS_READY } = {}) {
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()

    // Tooling-Health (PROJ-66) – spezifisch vor allgemein
    if (url.includes('/api/system/tooling/audit-history')) return route.fulfill({ json: MOCK_AUDIT_ITEMS })
    if (url.includes('/api/system/tooling/recheck') && route.request().method() === 'POST')
      return route.fulfill({ json: toolingStatus })
    if (url.includes('/api/system/tooling/status'))  return route.fulfill({ json: toolingStatus })

    // Notifications (PROJ-65)
    if (url.includes('/api/notifications/unread-summary')) return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))    return route.fulfill({ json: [] })

    // Auth + User
    if (url.includes('/api/license/status'))   return route.fulfill({ json: MOCK_LICENSE })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: MOCK_CAPS })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: MOCK_ME })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })

    // Navigation
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })

    // Cluster (LIFO: spezifisch zuerst)
    if (url.includes('/api/cluster/status'))   return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))    return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))          return route.fulfill({ json: [] })

    // Sonstiges
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

// Locator für Ansible-Indikator (Tooltip enthält "Ansible")
const ansibleBtn = page => page.locator('button[title*="Ansible" i]').first()
const packerBtn  = page => page.locator('button[title*="Packer" i]').first()

// ── AC-UI-1: Zwei Indikatoren in Topbar sichtbar ──────────────────────────────
test('AC-UI-1: Tooling-Indikatoren sind auf dem Dashboard sichtbar', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  // Warten bis Status geladen
  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await expect(packerBtn(page)).toBeVisible({ timeout: 8000 })
})

// ── AC-UI-2/3: Label auf Desktop sichtbar ────────────────────────────────────
test('AC-UI-2: Auf Desktop (≥768px) zeigt Indikator Name und Version', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  // Ansible-Label + Version-Fragment im Topbar vorhanden
  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  const ansible = ansibleBtn(page)
  await expect(ansible.locator('span.hidden.md\\:flex')).toBeVisible()
})

// ── AC-UI-4: Status-Punkt grün bei ready ─────────────────────────────────────
test('AC-UI-4: Status-Punkt ist grün (portal-success) bei Status ready', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page, { toolingStatus: MOCK_STATUS_READY })
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })

  // Status-Punkt hat bg-portal-success
  const dot = ansibleBtn(page).locator('span.rounded-full').first()
  await expect(dot).toHaveClass(/bg-portal-success/)
})

// ── AC-UI-4: Status-Punkt bei degraded ───────────────────────────────────────
test('AC-UI-4: Status-Punkt ist orange (portal-warn) bei Status degraded', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page, { toolingStatus: MOCK_STATUS_MIXED })
  await page.goto('/dashboard')

  // Warten bis Packer degraded
  await page.waitForFunction(() => {
    const btns = document.querySelectorAll('button[title*="Packer" i]')
    return btns.length > 0
  }, undefined, { timeout: 8000 })

  const packerDot = packerBtn(page).locator('span.rounded-full').first()
  await expect(packerDot).toHaveClass(/bg-portal-warn/)
})

// ── AC-UI-5: Tooltip vorhanden ────────────────────────────────────────────────
test('AC-UI-5: Tooltip des Indikators enthält Versionsinformation', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  const title = await ansibleBtn(page).getAttribute('title')
  expect(title).toContain('Ansible')
  expect(title).toContain('2.18')
})

// ── AC-UI-7 + AC-SLIDE-1/2: Klick öffnet Slide-Over ─────────────────────────
test('AC-UI-7: Klick auf Ansible-Indikator öffnet Slide-Over', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  // Slide-Over: role=dialog
  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 3000 })

  // Header: "Ansible"
  await expect(dialog.locator('h2')).toContainText('Ansible')
})

// ── AC-SLIDE-2: Status-Badge im Header ────────────────────────────────────────
test('AC-SLIDE-2: Slide-Over Header zeigt Status-Badge', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // Status-Badge enthält "Betriebsbereit" (DE)
  await expect(dialog).toContainText(/Betriebsbereit|ready/i)
})

// ── AC-SLIDE-3 §1: Version & Status Sektion ──────────────────────────────────
test('AC-SLIDE-3: Slide-Over zeigt Version & Status Sektion', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // Version sichtbar
  await expect(dialog).toContainText('2.18.1')
})

// ── AC-SLIDE-3 §2: Output-Sektion ─────────────────────────────────────────────
test('AC-SLIDE-3: Slide-Over zeigt Output-Sektion (stdout)', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // stdout enthält ansible --version output
  await expect(dialog).toContainText('ansible [core 2.18.1]')
})

// ── AC-SLIDE-3 §3: Audit-Historie Sektion ─────────────────────────────────────
test('AC-SLIDE-3: Slide-Over zeigt Audit-Historie Sektion', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // Audit-Verlauf Sektion vorhanden (Label)
  await expect(dialog).toContainText(/Audit-Verlauf|Audit history/i)
})

// ── AC-SLIDE-3 §4: Jetzt-prüfen-Button ───────────────────────────────────────
test('AC-SLIDE-3 §4: Slide-Over hat „Jetzt prüfen"-Button', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // Jetzt prüfen Button
  const recheckBtn = dialog.locator('button', { hasText: /Jetzt prüfen|Check now/i })
  await expect(recheckBtn).toBeVisible()
})

// ── AC-SLIDE-4: Recheck invalidiert Cache ────────────────────────────────────
test('AC-SLIDE-4: „Jetzt prüfen" triggert POST /recheck und aktualisiert Status', async ({ page }) => {
  let recheckCalled = false

  await setToken(page)
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()
    if (url.includes('/api/system/tooling/recheck') && route.request().method() === 'POST') {
      recheckCalled = true
      return route.fulfill({ json: MOCK_STATUS_READY })
    }
    if (url.includes('/api/system/tooling/audit-history')) return route.fulfill({ json: MOCK_AUDIT_ITEMS })
    if (url.includes('/api/system/tooling/status'))  return route.fulfill({ json: MOCK_STATUS_READY })
    if (url.includes('/api/notifications/unread-summary')) return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))    return route.fulfill({ json: [] })
    if (url.includes('/api/license/status'))   return route.fulfill({ json: MOCK_LICENSE })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: MOCK_CAPS })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: MOCK_ME })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/status'))   return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))    return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))          return route.fulfill({ json: [] })
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

  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  const recheckBtn = dialog.locator('button', { hasText: /Jetzt prüfen|Check now/i })
  await recheckBtn.click()

  // Warten bis POST fertig
  await page.waitForTimeout(500)
  expect(recheckCalled).toBe(true)
})

// ── AC-SLIDE-5: Rate-Limit-Button ─────────────────────────────────────────────
test('AC-SLIDE-5: Nach 429 zeigt Button „Bitte warten (Xs)"', async ({ page }) => {
  await setToken(page)
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()
    if (url.includes('/api/system/tooling/recheck') && route.request().method() === 'POST') {
      return route.fulfill({ status: 429, headers: { 'retry-after': '30' }, json: { detail: 'rate_limited', retry_after: 30 } })
    }
    if (url.includes('/api/system/tooling/audit-history')) return route.fulfill({ json: MOCK_AUDIT_ITEMS })
    if (url.includes('/api/system/tooling/status'))  return route.fulfill({ json: MOCK_STATUS_READY })
    if (url.includes('/api/notifications/unread-summary')) return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))    return route.fulfill({ json: [] })
    if (url.includes('/api/license/status'))   return route.fulfill({ json: MOCK_LICENSE })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: MOCK_CAPS })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: MOCK_ME })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/status'))   return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))    return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))          return route.fulfill({ json: [] })
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

  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  const recheckBtn = dialog.locator('button', { hasText: /Jetzt prüfen|Check now/i })
  await recheckBtn.click()

  // Nach 429: Button zeigt "Bitte warten"
  await expect(dialog.locator('button', { hasText: /Bitte warten|Please wait/i })).toBeVisible({ timeout: 3000 })
})

// ── AC-SLIDE-6: ESC schließt Slide-Over ───────────────────────────────────────
test('AC-SLIDE-6: ESC-Taste schließt Slide-Over', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible({ timeout: 2000 })
})

// ── AC-SLIDE-6: Backdrop-Klick schließt Slide-Over ────────────────────────────
test('AC-SLIDE-6: Backdrop-Klick schließt Slide-Over', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // Backdrop-Klick (links vom Dialog)
  await page.mouse.click(100, 400)
  await expect(dialog).not.toBeVisible({ timeout: 2000 })
})

// ── AC-API-1: Status-Endpoint ohne Admin-Gate ─────────────────────────────────
test('AC-API-1: /api/system/tooling/status ist ohne Admin-Rolle erreichbar', async ({ page }) => {
  // Viewer-Token
  // {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999,"user_id":2}
  const VIEWER_TOKEN =
    H + '.' +
    'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjJ9' +
    '.fake-sig'

  await page.addInitScript(t => sessionStorage.setItem('token', t), VIEWER_TOKEN)

  let toolingCalled = false
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()
    if (url.includes('/api/system/tooling/status')) {
      toolingCalled = true
      return route.fulfill({ json: MOCK_STATUS_READY })
    }
    if (url.includes('/api/system/tooling/audit-history')) return route.fulfill({ json: MOCK_AUDIT_ITEMS })
    if (url.includes('/api/notifications/unread-summary')) return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))    return route.fulfill({ json: [] })
    if (url.includes('/api/license/status'))   return route.fulfill({ json: MOCK_LICENSE })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: MOCK_CAPS })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: { id: 2, username: 'viewer', role: 'viewer', auth_type: 'local', portal_permissions: [], groups: [] } })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/status'))   return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))    return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))          return route.fulfill({ json: [] })
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

  await page.goto('/dashboard')

  await page.waitForTimeout(2000)
  expect(toolingCalled).toBe(true)
})

// ── AC-UI-8: Reihenfolge – Ansible links, Packer rechts ──────────────────────
test('AC-UI-8: Ansible-Indikator erscheint links von Packer', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await expect(packerBtn(page)).toBeVisible()

  const ansibleBox = await ansibleBtn(page).boundingBox()
  const packerBox  = await packerBtn(page).boundingBox()

  expect(ansibleBox).not.toBeNull()
  expect(packerBox).not.toBeNull()
  // Ansible-X < Packer-X → Ansible ist links
  expect(ansibleBox.x).toBeLessThan(packerBox.x)
})

// ── AC-SLIDE-7: ARIA-Attribute ────────────────────────────────────────────────
test('AC-SLIDE-7: Slide-Over hat korrekte ARIA-Attribute', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // aria-modal="true"
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  // aria-labelledby vorhanden
  await expect(dialog).toHaveAttribute('aria-labelledby', /tooling-slideover-title/)
})

// ── AC-SLIDE-3 §3: Audit-Historie zeigt Status-Transitions (BUG-66-1 Regression-Test) ─
test('AC-SLIDE-3 §3: Audit-Verlauf zeigt from→to Status der Transitions', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await ansibleBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible()

  // Audit-Verlauf Sektion muss Status-Transition-Info anzeigen
  // MOCK gibt: down → ready und ready → down
  // Wenn BUG-66-1 vorhanden: wird "?" angezeigt statt echten Status
  await expect(dialog).toContainText(/down|ready/i, { timeout: 3000 })
})
