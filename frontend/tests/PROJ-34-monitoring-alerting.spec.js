// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ────────────────────────────────────────────────────────────────
// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }

const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const PLUS_LICENSE = {
  edition: 'plus_v1', valid: true, contact_name: 'Test', contact_email: 'test@example.com',
  expiry: '2099-01-01', reason: null,
  limits: { users: { current: 1, max: null, unlimited: true }, presets: { current: 0, max: null, unlimited: true } },
}

const FAKE_NODES = [
  {
    node: 'pve1', status: 'online',
    cpu: 0.12, maxcpu: 8,
    mem: 4294967296, maxmem: 17179869184,
    disk: 10737418240, maxdisk: 107374182400,
    uptime: 172800,
  },
]
const FAKE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

const MOCK_ADMIN_NODE = {
  id: 1, name: 'Heimserver', url: 'https://pve.example.com:8006',
  proxmox_node: 'pve', verify_ssl: true, poll_interval: 30,
  viewer_token_id: 'viewer@pam!tok', operator_token_id: null,
  admin_token_id: null, packer_token_id: null,
  is_default: true, cluster_nodes: [], created_at: '2026-01-01T00:00:00Z', created_by: 'admin',
}

const ACTIVE_WARNING_STATE = {
  id: 1, rule_id: 1, rule_name: 'CPU Alert', vmid: '100', node_id: 1,
  severity: 'warning', state: 'warning', pending_count: 2,
  last_value: 82.5, last_checked_at: '2026-05-06T10:00:00Z', last_changed_at: '2026-05-06T10:00:00Z',
}

const ACTIVE_CRITICAL_STATE = {
  id: 2, rule_id: 2, rule_name: 'RAM Alert', vmid: '101', node_id: 1,
  severity: 'critical', state: 'critical', pending_count: 3,
  last_value: 97.1, last_checked_at: '2026-05-06T10:00:00Z', last_changed_at: '2026-05-06T10:00:00Z',
}

const GLOBAL_RULE = {
  id: 1, scope: 'global', preset_id: null, vmid: null, node_id: null,
  name: 'CPU-Auslastung hoch', metric: 'cpu_percent',
  warning_threshold: 80, critical_threshold: 95,
  sustained_polls: 2, enabled: true, notify_recovery: true,
  filesystem: null, webhook_url: null, email_recipients: null,
  created_by: 'admin', created_at: '2026-05-06T10:00:00Z', updated_at: '2026-05-06T10:00:00Z',
}

const FAKE_ALERT_EVENTS = [
  {
    id: 1, rule_id: 1, rule_name: 'CPU Alert', vmid: '100', node_id: 1,
    vm_name: 'web-server', metric: 'cpu_percent', value: 92.3, threshold: 80,
    severity: 'warning', state: 'firing', timestamp: '2026-05-06T10:00:00Z',
    acknowledged_by: [],
  },
  {
    id: 2, rule_id: 2, rule_name: 'RAM Alert', vmid: '101', node_id: 1,
    vm_name: 'db-server', metric: 'mem_percent', value: 97.1, threshold: 90,
    severity: 'critical', state: 'resolved', timestamp: '2026-05-06T09:00:00Z',
    acknowledged_by: ['admin'],
  },
]

const VM_ALERT_SUMMARY = {
  vmid: '100', node_id: 1, preset: null, vm_rules: [], effective_rules: [], overrides: [],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function mockCommon(page, role = 'admin') {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: role, auth_type: 'local', role, active: true }),
  }))
  await page.route('/api/playbooks', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_ADMIN_NODE]) }))
}

async function mockCluster(page) {
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) }))
}

async function mockLicense(page, license) {
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(license) }))
}

async function mockAlertStates(page, states) {
  await page.route('/api/alerts/states', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(states) }))
}

async function mockAlertRules(page, rules) {
  await page.route('/api/alerts/rules', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rules) }))
}

async function mockAlertPresets(page, presets, statusCode = 200) {
  await page.route('/api/alerts/presets', r =>
    r.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(presets) }))
}

async function mockAlertEvents(page, events) {
  await page.route('/api/alerts/events**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(events) }))
}

async function mockSmtpConfig(page, statusCode = 200) {
  await page.route('/api/admin/alerts/smtp', r =>
    r.fulfill({ status: statusCode, contentType: 'application/json',
      body: JSON.stringify({ host: null, port: 587, username: null, use_tls: true, from_address: null, configured: false }) }))
}

async function gotoDashboard(page) {
  await page.goto('/')
  await page.waitForTimeout(400)
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Dashboard – AlertsBanner
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-34 – Dashboard AlertsBanner', () => {

  test('AC-BANNER-1: Kein Banner wenn keine aktiven Alerts', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [])
    await gotoDashboard(page)

    await expect(page.locator('text=Warnung')).not.toBeVisible()
    await expect(page.locator('text=Kritisch')).not.toBeVisible()
  })

  test('AC-BANNER-2: Warning-Banner (gelb) bei aktivem Warning-Alert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [ACTIVE_WARNING_STATE])
    await gotoDashboard(page)

    await expect(page.locator('text=Warnung')).toBeVisible()
    await expect(page.locator('text=CPU Alert')).toBeVisible()
  })

  test('AC-BANNER-3: Critical-Banner (rot) bei aktivem Critical-Alert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [ACTIVE_CRITICAL_STATE])
    await gotoDashboard(page)

    await expect(page.locator('text=Kritisch')).toBeVisible()
    await expect(page.locator('text=RAM Alert')).toBeVisible()
  })

  test('AC-BANNER-4: Bestätigen-Button sichtbar, lokale Dismiss funktioniert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [ACTIVE_WARNING_STATE])
    await gotoDashboard(page)

    const ackBtn = page.getByRole('button', { name: 'Bestätigen' })
    await expect(ackBtn).toBeVisible()
    await ackBtn.click()
    await page.waitForTimeout(200)

    // After ack, banner should disappear (local dismiss)
    await expect(page.locator('text=CPU Alert')).not.toBeVisible()
  })

  test('AC-BANNER-5: Critical-Alerts erscheinen vor Warning-Alerts (Sortierung)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [ACTIVE_WARNING_STATE, ACTIVE_CRITICAL_STATE])
    await gotoDashboard(page)

    const severityBadges = page.locator('text=/Kritisch|Warnung/')
    const count = await severityBadges.count()
    expect(count).toBe(2)
    // First badge should be "Kritisch"
    await expect(severityBadges.first()).toHaveText('Kritisch')
  })

  test('BUG-34-1 fix: RAM-Alert zeigt RAM-Label, nicht CPU', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [{
      id: 1, rule_id: 1, rule_name: 'My Rule', metric: 'mem_percent', vmid: '100', node_id: 1,
      severity: 'warning', state: 'warning', pending_count: 1,
      last_value: 90.0, last_checked_at: '2026-05-06T10:00:00Z', last_changed_at: '2026-05-06T10:00:00Z',
      last_event_id: null,
    }])
    await gotoDashboard(page)

    // MetricLabel should show "RAM" for mem_percent
    await expect(page.locator('text=/RAM 90\\.0/')).toBeVisible()
    // Must NOT show CPU label for a RAM alert
    await expect(page.locator('text=/CPU 90\\.0/')).not.toBeVisible()
  })

  test('BUG-34-2 fix: Bestätigen sendet API-Request mit last_event_id', async ({ page }) => {
    let ackCalled = false
    let ackEventId = null

    await setupAdmin(page)
    await mockCommon(page)
    await mockCluster(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertStates(page, [{
      id: 1, rule_id: 1, rule_name: 'CPU Alert', metric: 'cpu_percent', vmid: '100', node_id: 1,
      severity: 'warning', state: 'warning', pending_count: 1,
      last_value: 82.5, last_checked_at: '2026-05-06T10:00:00Z', last_changed_at: '2026-05-06T10:00:00Z',
      last_event_id: 42,
    }])
    await page.route('/api/alerts/events/42/acknowledge', async (route) => {
      ackCalled = true
      ackEventId = 42
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"alert_event_id":42}' })
    })
    await gotoDashboard(page)

    await expect(page.getByRole('button', { name: 'Bestätigen' })).toBeVisible()
    await page.getByRole('button', { name: 'Bestätigen' }).click()
    await page.waitForTimeout(300)

    expect(ackCalled).toBe(true)
    expect(ackEventId).toBe(42)
    // Banner should disappear after ack
    await expect(page.locator('text=CPU Alert')).not.toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 2. Admin Settings – Monitoring Tab
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-34 – Admin Settings Monitoring Tab', () => {

  test('AC-ADMIN-1: Monitoring-Tab erscheint in Admin-Einstellungen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)

    await expect(page.locator('text=Monitoring')).toBeVisible()
  })

  test('AC-ADMIN-2: Globale Regeln-Tab zeigt leere Liste (Basis)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=Globale Alert-Regeln')).toBeVisible()
    await expect(page.locator('text=Keine globalen Regeln')).toBeVisible()
  })

  test('AC-ADMIN-3: Vorhandene globale Regel wird in der Liste angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [GLOBAL_RULE])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=CPU-Auslastung hoch')).toBeVisible()
    await expect(page.getByRole('cell', { name: 'CPU', exact: true })).toBeVisible()
  })

  test('AC-ADMIN-4: "Neue Regel"-Button öffnet Formular-Modal', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: '+ Neue Regel' }).click()
    await expect(page.locator('text=Neue Regel erstellen')).toBeVisible()
  })

  test('AC-ADMIN-5: Preset-Tab zeigt Plus-Meldung auf Basis-Edition', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)

    // Alert-Presets erfordern Plus-Lizenz (403 mock returns error message)
    await expect(page.locator('text=Alert-Presets erfordern eine Plus-Lizenz.')).toBeVisible()
  })

  test('AC-ADMIN-6: Plus-Edition zeigt Preset-Formulare und SMTP-Konfiguration', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [])
    await mockSmtpConfig(page, 200)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=+ Neues Preset')).toBeVisible()
    await expect(page.locator('text=E-Mail / SMTP')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 3. Alert-Regel Formular
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-34 – Alert-Regel Formular', () => {

  test('AC-FORM-1: Formular-Felder für CPU-Metric korrekt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '+ Neue Regel' }).click()

    // Check for modal-specific elements using the modal container context
    const modal = page.locator('.fixed.inset-0')
    await expect(modal.locator('text=Name')).toBeVisible()
    await expect(modal.locator('text=Metrik')).toBeVisible()
    await expect(modal.locator('text=Warnung (%)')).toBeVisible()
    await expect(modal.locator('text=Kritisch (%)')).toBeVisible()
    await expect(modal.locator('text=Auslösung nach N Polls')).toBeVisible()
  })

  test('AC-FORM-2: Disk-Metric zeigt Dateisystem-Feld', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '+ Neue Regel' }).click()

    await page.selectOption('select', 'disk_percent')
    await expect(page.locator('text=Dateisystem (optional)')).toBeVisible()
  })

  test('AC-FORM-3: Webhook-Felder nur bei Plus-Edition sichtbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [])
    await mockSmtpConfig(page, 200)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '+ Neue Regel' }).click()

    await expect(page.locator('text=Webhook-URL')).toBeVisible()
    await expect(page.locator('text=E-Mail-Empfänger')).toBeVisible()
  })

  test('AC-FORM-4: Regel kann gespeichert werden (HTTP POST mock)', async ({ page }) => {
    let postBody = null
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.route('/api/alerts/rules', async (route) => {
      if (route.request().method() === 'POST') {
        postBody = JSON.parse(route.request().postData())
        await route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ ...GLOBAL_RULE, ...postBody }),
        })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
    })

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '+ Neue Regel' }).click()

    await page.fill('input[placeholder="z. B. CPU-Auslastung hoch"]', 'Test Regel')
    const spinbuttons = page.getByRole('spinbutton')
    await spinbuttons.first().fill('70')

    // Use modal-scoped click to avoid hitting SMTP "Speichern" button
    const modal = page.locator('.fixed.inset-0')
    await modal.getByRole('button', { name: 'Speichern' }).click()
    await page.waitForTimeout(300)

    expect(postBody).not.toBeNull()
    expect(postBody.name).toBe('Test Regel')
    expect(postBody.metric).toBe('cpu_percent')
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 4. Alert-Historie (JobsPage)
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-34 – Alert-Historie Tab', () => {

  test('AC-HIST-1: Alert-Historie-Tab erscheint in JobsPage', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await page.route('/api/jobs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/logs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/proxmox-audit**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await mockAlertEvents(page, [])

    await page.goto('/logs')
    await page.waitForTimeout(300)

    await expect(page.locator('text=Alert-Historie')).toBeVisible()
  })

  test('AC-HIST-2: Alert-Ereignisse werden in der Tabelle angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await page.route('/api/jobs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/logs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/proxmox-audit**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await mockAlertEvents(page, FAKE_ALERT_EVENTS)

    await page.goto('/logs')
    await page.waitForTimeout(300)
    await page.locator('text=Alert-Historie').click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=CPU Alert')).toBeVisible()
    await expect(page.locator('text=RAM Alert')).toBeVisible()
    // Use table-scoped locator to avoid strict mode violation with filter select option
    await expect(page.getByRole('table').locator('text=Auslösung')).toBeVisible()
    await expect(page.getByRole('table').locator('text=Erholt')).toBeVisible()
  })

  test('AC-HIST-3: Best.-Button erscheint für unbestätigte firing-Events', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await page.route('/api/jobs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/logs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/proxmox-audit**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await mockAlertEvents(page, [FAKE_ALERT_EVENTS[0]])

    await page.goto('/logs')
    await page.waitForTimeout(300)
    await page.locator('text=Alert-Historie').click()
    await page.waitForTimeout(300)

    // Unacknowledged firing event should show "Best." button
    await expect(page.locator('text=Best.').first()).toBeVisible()
  })

  test('AC-HIST-4: Bereits bestätigte Events zeigen ✓ Best. statt Button', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await page.route('/api/jobs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/logs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/proxmox-audit**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await mockAlertEvents(page, [FAKE_ALERT_EVENTS[1]])

    await page.goto('/logs')
    await page.waitForTimeout(300)
    await page.locator('text=Alert-Historie').click()
    await page.waitForTimeout(300)

    // Already acknowledged event should show "✓ Best." text
    await expect(page.locator('text=✓ Best.')).toBeVisible()
  })

  test('AC-HIST-5: Filter nach Zustand funktioniert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await page.route('/api/jobs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/logs**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('/api/admin/proxmox-audit**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    let lastFilter = null
    await page.route('/api/alerts/events**', (route) => {
      const url = new URL(route.request().url())
      lastFilter = url.searchParams.get('state')
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_ALERT_EVENTS) })
    })

    await page.goto('/logs')
    await page.waitForTimeout(300)
    await page.locator('text=Alert-Historie').click()
    await page.waitForTimeout(300)

    await page.selectOption('select', 'firing')
    await page.waitForTimeout(300)

    expect(lastFilter).toBe('firing')
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 5. VM-Detailseite – Alerts-Tab
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-34 – VM-Detailseite Alerts-Tab', () => {

  const VM_DETAIL = {
    vmid: 100, name: 'web-server', status: 'running', node: 'pve', node_id: 1,
    type: 'qemu', ip: null, uptime: 3600, tags: [], is_template: false,
    cpu_usage: 0.1, cpu_cores: 2, mem_used: 1073741824, mem_total: 2147483648,
    bios: 'seabios', ostype: 'l26', cpu_type: 'kvm64', sockets: 1,
    onboot: true, protection: false, description: null,
    networks: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' }],
    disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G' }],
    lxc_hostname: null, lxc_ostemplate: null,
  }

  async function setupVmDetailPage(page) {
    await setupAdmin(page)
    // Base API routes (mirrors PROJ-32 mockBaseApi pattern)
    await page.route('**/api/me', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }),
    }))
    await page.route('**/api/license/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
    await page.route('**/api/themes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/playbooks', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/admin/settings', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        proxmox_node: 'pve', vm_id_range_start: 100, vm_id_range_end: 199,
        playbook_vm_id_range_start: 200, playbook_vm_id_range_end: 299 }) }))
    await page.route('**/api/admin/nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_ADMIN_NODE]) }))
    await page.route('**/api/admin/users', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/announcements', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    // Alert routes (must be registered before the specific cluster/vms routes)
    await page.route('**/api/alerts/states', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/alerts/vm/1/100', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VM_ALERT_SUMMARY) }))
    // VM detail routes (specific paths – register AFTER generic alert routes so LIFO priority is correct)
    await page.route('**/api/cluster/vms/pve/qemu/100/guest-info', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await page.route('**/api/cluster/vms/pve/qemu/100/backups', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/cluster/vms/pve/qemu/100', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VM_DETAIL) }))
    await page.route('**/api/vms/100/snapshots', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  }

  test('AC-VM-1: Alerts-Tab erscheint auf VM-Detailseite', async ({ page }) => {
    await setupVmDetailPage(page)
    await page.goto('/vm/pve/qemu/100')
    await page.waitForTimeout(800)
    await expect(page.getByRole('button', { name: 'Alerts' })).toBeVisible()
  })

  test('AC-VM-2: Alerts-Tab zeigt "Keine aktiven Alerts" wenn kein aktiver Alert', async ({ page }) => {
    await setupVmDetailPage(page)
    await page.goto('/vm/pve/qemu/100')
    await page.waitForTimeout(800)

    await page.getByRole('button', { name: 'Alerts' }).click()
    await page.waitForTimeout(400)

    await expect(page.locator('text=Keine aktiven Alerts')).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 6. Edition-Gating
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-34 – Edition-Gating', () => {

  test('AC-GATE-1: Basis-Edition zeigt keine Webhook-Felder im Regel-Formular', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '+ Neue Regel' }).click()

    await expect(page.locator('text=Webhook-URL')).not.toBeVisible()
    await expect(page.locator('text=E-Mail-Empfänger')).not.toBeVisible()
  })

  test('AC-GATE-2: Plus – Neue Regel-Formular zeigt Plus-Benachrichtigungsfelder', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [])
    await mockSmtpConfig(page, 200)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '+ Neue Regel' }).click()

    await expect(page.locator('text=Plus – Benachrichtigungen')).toBeVisible()
    await expect(page.locator('text=Webhook-URL')).toBeVisible()
  })

  test('AC-GATE-3: Preset-Abschnitt zeigt Plus-Label', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockAlertRules(page, [])
    await mockAlertPresets(page, [], 403)
    await mockSmtpConfig(page, 403)

    await page.goto('/admin/settings')
    await page.waitForTimeout(300)
    await page.locator('text=Monitoring').click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=Alert-Presets').first()).toBeVisible()
  })

})
