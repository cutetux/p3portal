// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Payloads sind Base64-kodierte JWTs ohne echte Signatur (parseJwtPayload liest nur den Payload-Teil).

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten (PROJ-65: type→severity migriert) ─────────────────────────────

const ANN_WARN = {
  id: 1, message: 'Wartungsfenster heute Nacht', severity: 'warn',
  active: true, expires_at: null, created_by: 'admin',
  created_at: '2026-05-01T10:00:00Z', updated_at: '2026-05-01T10:00:00Z', expired: false,
}
const ANN_INFO = {
  id: 2, message: 'Neues Feature verfügbar', severity: 'info',
  active: true, expires_at: null, created_by: 'admin',
  created_at: '2026-05-02T10:00:00Z', updated_at: '2026-05-02T10:00:00Z', expired: false,
}
const ANN_ERROR = {
  id: 3, message: 'Kritischer Fehler erkannt', severity: 'critical',
  active: true, expires_at: null, created_by: 'admin',
  created_at: '2026-05-03T10:00:00Z', updated_at: '2026-05-03T10:00:00Z', expired: false,
}
const ANN_INACTIVE = {
  id: 4, message: 'Deaktivierte Meldung', severity: 'info',
  active: false, expires_at: null, created_by: 'admin',
  created_at: '2026-05-03T12:00:00Z', updated_at: '2026-05-03T12:00:00Z', expired: false,
}
const ANN_EXPIRED = {
  id: 5, message: 'Abgelaufene Meldung', severity: 'warn',
  active: true, expires_at: '2000-01-01T00:00:00Z', created_by: 'admin',
  created_at: '2026-04-30T10:00:00Z', updated_at: '2026-04-30T10:00:00Z', expired: true,
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommonApi(page) {
  // PROJ-65: Notification-Endpoints – LIFO: allgemein zuerst, spezifisch danach
  await page.route(/localhost:\d+\/api\/notifications/, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([]),
    })
  )
  await page.route(/localhost:\d+\/api\/notifications\/unread-summary/, (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null }),
    })
  )
  // Auth + Setup
  await page.route('/api/setup/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ setup_required: false }) })
  )
  await page.route('/api/capabilities', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        alert_presets: false, alerts_smtp: false, theme_editor: false,
        multiple_nodes: false, approval_workflow: false, allow_self_approval_supported: false,
        pools_quotas: false, playbook_permissions: false, extra_portal_permissions: [],
      }),
    })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roles: [], permissions: [] }) })
  )
  await page.route('/api/me', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ id: 1, username: 'viewer', role: 'viewer', auth_type: 'local', portal_permissions: [], groups: [] }),
    })
  )
  await page.route('/api/portal/config', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ active_theme: 'light', active_lang: 'de', interface_version: 'v2' }),
    })
  )
  // Sidebar
  await page.route('/api/sidebar-pins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  // Cluster (spezifisch vor allgemein – Playwright LIFO)
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }),
    })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  // Admin + Content
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/settings', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ proxmox_node: 'pve01', vm_id_range_start: 100, vm_id_range_end: 199, playbook_vm_id_range_start: 200, playbook_vm_id_range_end: 299 }),
    })
  )
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: 1, name: 'pve01', host: '192.168.1.10', is_cluster: false, is_default: true }]),
    })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/themes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: 'plus', valid: true }),
    })
  )
  await page.route('/api/jobs', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/i18n/default', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lang_code: 'de' }) })
  )
  await page.route('/api/help/overrides/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/help/overrides/global', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/alerts/summary', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/alerts/states', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

async function mockPublicAnnouncements(page, list) {
  await page.route('/api/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  )
}

async function mockAdminAnnouncements(page, list) {
  await page.route('/api/admin/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Dashboard – Banneranzeige
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Dashboard Ankündigungen-Banner', () => {
  test('zeigt aktive Ankündigungen auf dem Dashboard an', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN, ANN_INFO])
    await page.goto('/')

    await expect(page.getByText('Wartungsfenster heute Nacht')).toBeVisible()
    await expect(page.getByText('Neues Feature verfügbar')).toBeVisible()
  })

  test('zeigt kein Banner wenn keine aktiven Ankündigungen vorhanden', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await page.goto('/')

    // Banner-Bereich sollte nicht existieren
    await expect(page.locator('[aria-label="Ausblenden"]')).toHaveCount(0)
  })

  test('warn-Ankündigung hat Warn-Styling (portal-warn)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN])
    await page.goto('/')

    // AnnouncementsBanner nutzt portal-warn Token (border-portal-warn/40)
    const banner = page.locator('[class*="border-portal-warn"]').filter({ hasText: 'Wartungsfenster heute Nacht' })
    await expect(banner).toBeVisible()
  })

  test('info-Ankündigung hat Info-Styling (portal-info)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_INFO])
    await page.goto('/')

    const banner = page.locator('[class*="border-portal-info"]').filter({ hasText: 'Neues Feature verfügbar' })
    await expect(banner).toBeVisible()
  })

  test('critical-Ankündigung hat Danger-Styling (portal-danger)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_ERROR])
    await page.goto('/')

    const banner = page.locator('[class*="border-portal-danger"]').filter({ hasText: 'Kritischer Fehler erkannt' })
    await expect(banner).toBeVisible()
  })

  test('×-Button blendet Ankündigung aus (sessionStorage)', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN])
    await page.goto('/')

    await expect(page.getByText('Wartungsfenster heute Nacht')).toBeVisible()

    // Dismiss – Button hat aria-label="Ausblenden"
    const dismissBtn = page.locator('button[aria-label="Ausblenden"]').first()
    await expect(dismissBtn).toBeVisible()
    await dismissBtn.click()

    await expect(page.getByText('Wartungsfenster heute Nacht')).not.toBeVisible()

    // sessionStorage-Key gesetzt
    const key = await page.evaluate((id) => sessionStorage.getItem(`p3-announcement-dismissed-${id}`), ANN_WARN.id)
    expect(key).toBe('true')
  })

  test('mehrere Ankündigungen gestapelt angezeigt', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN, ANN_INFO, ANN_ERROR])
    await page.goto('/')

    await expect(page.getByText('Wartungsfenster heute Nacht')).toBeVisible()
    await expect(page.getByText('Neues Feature verfügbar')).toBeVisible()
    await expect(page.getByText('Kritischer Fehler erkannt')).toBeVisible()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Admin – System Settings → Integrations-Tab → Ankündigungen
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Admin Ankündigungen-Tab', () => {
  test('Ankündigungen-Sektion ist für Admin im Integrations-Tab sichtbar', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [])
    await page.goto('/system-settings?tab=integrations')

    await expect(page.getByRole('button', { name: 'Neue Ankündigung' })).toBeVisible()
  })

  test('Ankündigungen-Tab zeigt leeren State korrekt', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [])
    await page.goto('/system-settings?tab=integrations')

    await expect(page.getByText('Keine Ankündigungen vorhanden.')).toBeVisible()
  })

  test('Ankündigungen-Tab zeigt alle Ankündigungen (inkl. inaktiv/abgelaufen)', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN])
    await mockAdminAnnouncements(page, [ANN_WARN, ANN_INACTIVE, ANN_EXPIRED])
    await page.goto('/system-settings?tab=integrations')

    await expect(page.getByText('Wartungsfenster heute Nacht')).toBeVisible()
    await expect(page.getByText('Deaktivierte Meldung')).toBeVisible()
    await expect(page.getByText('Abgelaufene Meldung')).toBeVisible()
  })

  test('abgelaufene Ankündigung zeigt "Abgelaufen"-Badge', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [ANN_EXPIRED])
    await page.goto('/system-settings?tab=integrations')
    await page.waitForLoadState('networkidle')

    // StatusBadge zeigt "Abgelaufen" für abgelaufene Einträge
    await expect(page.locator('td').filter({ hasText: /^Abgelaufen$/ }).first()).toBeVisible()
  })

  test('"Neue Ankündigung"-Button öffnet Create-Modal', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [])
    await page.goto('/system-settings?tab=integrations')

    await page.getByRole('button', { name: 'Neue Ankündigung' }).click()

    await expect(page.getByRole('heading', { name: 'Neue Ankündigung' })).toBeVisible()
    await expect(page.locator('textarea')).toBeVisible()
  })

  test('Create-Modal: Submit-Button deaktiviert wenn Nachricht leer', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [])
    await page.goto('/system-settings?tab=integrations')

    await page.getByRole('button', { name: 'Neue Ankündigung' }).click()

    const saveBtn = page.getByRole('button', { name: 'Speichern' })
    await expect(saveBtn).toBeDisabled()
  })

  test('Create-Modal: Ankündigung erstellen sendet POST-Request mit severity', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [])

    let capturedBody = null
    await page.route('/api/admin/announcements', (route) => {
      if (route.request().method() === 'POST') {
        capturedBody = route.request().postDataJSON()
        route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ ...ANN_WARN, id: 10, message: capturedBody?.message }),
        })
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
    })

    await page.goto('/system-settings?tab=integrations')
    await page.getByRole('button', { name: 'Neue Ankündigung' }).click()

    await page.locator('textarea').fill('Neue Testnachricht')

    // Warn-Typ wählen (Radio-Label "Warnung" enthält "warn")
    await page.getByRole('radio', { name: /warn/i }).check()

    await page.getByRole('button', { name: 'Speichern' }).click()

    // Request wurde gesendet mit severity-Feld (PROJ-65: type→severity)
    expect(capturedBody).not.toBeNull()
    expect(capturedBody.message).toBe('Neue Testnachricht')
    expect(capturedBody.severity).toBe('warn')
  })

  test('Edit-Modal öffnet sich mit bestehenden Werten vorausgefüllt', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN])
    await mockAdminAnnouncements(page, [ANN_WARN])
    await page.goto('/system-settings?tab=integrations')

    await page.getByRole('button', { name: 'Bearbeiten' }).first().click()

    await expect(page.getByRole('heading', { name: 'Ankündigung bearbeiten' })).toBeVisible()
    await expect(page.locator('textarea')).toHaveValue(ANN_WARN.message)
  })

  test('Delete-Modal zeigt Ankündigungs-Text und sendet DELETE-Request', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN])

    let deleteWasCalled = false
    // Separate Routen für GET (Liste) vs DELETE (Löschen)
    await page.route(`/api/admin/announcements/${ANN_WARN.id}`, (route) => {
      if (route.request().method() === 'DELETE') {
        deleteWasCalled = true
        route.fulfill({ status: 204 })
      } else {
        route.continue()
      }
    })
    await page.route('/api/admin/announcements', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ANN_WARN]) })
    })

    await page.goto('/system-settings?tab=integrations')
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Löschen' }).first().click()

    // Bestätigungs-Modal
    const deleteModal = page.locator('.fixed.inset-0').filter({ hasText: 'Ankündigung löschen' })
    await expect(deleteModal).toBeVisible()

    // Der Modal-Text zeigt die Ankündigung in Anführungszeichen (eingegrenzt auf den Modal-Container)
    await expect(deleteModal.getByText(ANN_WARN.message)).toBeVisible()

    await deleteModal.getByRole('button', { name: 'Löschen' }).click()

    expect(deleteWasCalled).toBe(true)
  })

  test('Active-Toggle sendet PUT-Request mit invertiertem active-Wert', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_WARN])

    let putBody = null
    await page.route('/api/admin/announcements**', (route) => {
      if (route.request().method() === 'PUT') {
        putBody = route.request().postDataJSON()
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ...ANN_WARN, active: false }),
        })
      } else {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([ANN_WARN]) })
      }
    })

    await page.goto('/system-settings?tab=integrations')

    // Toggle-Button für aktive Ankündigung
    await page.getByRole('button', { name: 'Aktiv/Inaktiv umschalten' }).first().click()

    expect(putBody).not.toBeNull()
    expect(putBody.active).toBe(false)
  })

  test('Hinweis bei mehr als 3 aktiven Ankündigungen', async ({ page }) => {
    const manyAnn = [
      { ...ANN_WARN, id: 1 },
      { ...ANN_INFO, id: 2 },
      { ...ANN_ERROR, id: 3 },
      { id: 4, message: '4. Ankündigung', severity: 'info', active: true, expires_at: null, created_by: 'admin', created_at: '2026-05-04T10:00:00Z', updated_at: '2026-05-04T10:00:00Z', expired: false },
    ]

    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, manyAnn)
    await mockAdminAnnouncements(page, manyAnn)
    await page.goto('/system-settings?tab=integrations')

    await expect(page.getByText(/aktive Ankündigungen – das könnte das Dashboard überwältigen/)).toBeVisible()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Berechtigungen
// ══════════════════════════════════════════════════════════════════════════════

test.describe('Ankündigungen – Berechtigungen', () => {
  test('Viewer sieht Banner auf dem Dashboard', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [ANN_INFO])
    await page.goto('/')

    // Banner sichtbar für alle eingeloggten Nutzer
    await expect(page.getByText('Neues Feature verfügbar')).toBeVisible()
  })

  test('Admin kann Ankündigungen verwalten (Integrations-Tab)', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommonApi(page)
    await mockPublicAnnouncements(page, [])
    await mockAdminAnnouncements(page, [])
    await page.goto('/system-settings?tab=integrations')

    await expect(page.getByRole('button', { name: 'Neue Ankündigung' })).toBeVisible()
  })

  test('Public GET /api/announcements erfordert Authentifizierung (kein Token → kein Banner)', async ({ page }) => {
    // Kein Token gesetzt → automatisch zur Login-Seite geleitet
    await page.route('/api/announcements', (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Unauthorized"}' })
    )
    await mockCommonApi(page)
    await page.goto('/')

    // Kein Banner sichtbar, da Nutzer nicht eingeloggt (Login-Redirect)
    await expect(page.locator('[aria-label="Ausblenden"]')).toHaveCount(0)
  })
})
