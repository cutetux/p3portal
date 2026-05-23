// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ─────────────────────────────────────────────────────────────────
// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// operator mit manage_scheduled_jobs
const OP_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zY2hlZHVsZWRfam9icyJdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// viewer ohne manage_scheduled_jobs
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ─────────────────────────────────────────────────────────────────

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }
const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const MOCK_NODE = {
  id: 1, name: 'Heimserver', url: 'https://pve.example.com:8006',
  proxmox_node: 'pve', verify_ssl: true, poll_interval: 30,
  viewer_token_id: 'viewer@pam!tok', operator_token_id: null,
  admin_token_id: null, packer_token_id: null,
  is_default: true, cluster_nodes: [], created_at: '2026-01-01T00:00:00Z', created_by: 'admin',
}

const MOCK_SSH_JOB = {
  id: 1,
  name: 'Täglicher Patch-Check',
  description: 'Prüft apt upgrades',
  job_type: 'ssh',
  cron_expression: '0 8 * * *',
  active: true,
  config: { user_host: 'root@192.168.1.10', command: 'apt list --upgradable', ssh_key_source: 'system', timeout: 30 },
  created_by: 'admin',
  created_at: '2026-05-06T10:00:00Z',
  updated_at: '2026-05-06T10:00:00Z',
  last_run_at: '2026-05-06T08:00:05Z',
  last_run_status: 'success',
  next_run_at: '2026-05-07T08:00:00Z',
  child_job: null,
}

const MOCK_PLAYBOOK_JOB = {
  id: 2,
  name: 'Wöchentlicher Playbook-Run',
  description: null,
  job_type: 'playbook',
  cron_expression: '0 0 * * 1',
  active: true,
  config: { playbook: 'site.yml', params: { vm_name: 'web-server' } },
  created_by: 'admin',
  created_at: '2026-05-06T10:00:00Z',
  updated_at: '2026-05-06T10:00:00Z',
  last_run_at: null,
  last_run_status: null,
  next_run_at: '2026-05-12T00:00:00Z',
  child_job: null,
}

const MOCK_POWER_JOB = {
  id: 3,
  name: 'VM Start/Stop Fenster',
  description: 'Bürozeiten',
  job_type: 'power_action',
  cron_expression: '0 8 * * 1-5',
  active: false,
  config: { node: 'pve1', vmid: '100', vmtype: 'qemu', action: 'start' },
  created_by: 'admin',
  created_at: '2026-05-06T10:00:00Z',
  updated_at: '2026-05-06T10:00:00Z',
  last_run_at: '2026-05-06T08:00:01Z',
  last_run_status: 'failed',
  next_run_at: null,
  child_job: { id: 4, cron_expression: '0 20 * * 1-5', config: { node: 'pve1', vmid: '100', vmtype: 'qemu', action: 'stop' }, last_run_at: null, last_run_status: null, next_run_at: null },
}

const MOCK_RUNS = [
  {
    id: 1, job_id: 1,
    started_at: '2026-05-06T08:00:00Z',
    finished_at: '2026-05-06T08:00:05Z',
    exit_code: 0, status: 'success',
    stdout: 'Listing... Done\napt-get/jammy-updates 2.4.13 amd64 [upgradable from: 2.4.11]',
    stderr: '',
  },
  {
    id: 2, job_id: 1,
    started_at: '2026-05-05T08:00:00Z',
    finished_at: '2026-05-05T08:00:10Z',
    exit_code: 255, status: 'failed',
    stdout: '',
    stderr: 'ssh: connect to host 192.168.1.10 port 22: Connection timed out',
  },
]

const MOCK_SETTINGS = { history_limit: 20, has_system_ssh_key: false }
const MOCK_SETTINGS_WITH_KEY = { history_limit: 20, has_system_ssh_key: true }

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupOperator(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OP_TOKEN)
}

async function setupViewer(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), VIEWER_TOKEN)
}

async function mockCommon(page, role = 'admin') {
  // Use V1 sidebar so pre-PROJ-36 navigation tests remain valid
  await page.route('/api/settings/ui-version', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v1"}' }))
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      username: role, auth_type: 'local', role, active: true,
      portal_permissions: role === 'operator' ? ['manage_scheduled_jobs'] : [],
    }),
  }))
  await page.route('/api/playbooks', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) }))
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BASIS_LICENSE) }))
  await page.route('/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }) }))
  await page.route('/api/alerts/states', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockScheduledJobs(page, jobs) {
  await page.route('/api/scheduled-jobs', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(jobs),
  }))
}

async function mockScheduledJobRuns(page, jobId, runs) {
  await page.route(`/api/scheduled-jobs/${jobId}/runs`, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(runs),
  }))
}

async function mockScheduledJobDetail(page, job) {
  await page.route(`/api/scheduled-jobs/${job.id}`, r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(job),
  }))
}

async function mockSettings(page, settings = MOCK_SETTINGS) {
  await page.route('/api/admin/scheduled-jobs/settings', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(settings),
  }))
}

async function gotoScheduledJobs(page) {
  await page.goto('/scheduled-jobs')
  await page.waitForTimeout(400)
}

// ════════════════════════════════════════════════════════════════════════════════
// 1. Übersichtsseite – Liste & Tabelle
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – Scheduled Jobs Übersicht', () => {

  test('AC-LIST-1: Leere Tabelle zeigt Hinweis "Noch keine Scheduled Jobs"', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Noch keine Scheduled Jobs vorhanden.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Neuer Job' })).toBeVisible()
  })

  test('AC-LIST-2: SSH-Job wird in Tabelle mit Typ-Badge angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Täglicher Patch-Check')).toBeVisible()
    await expect(page.locator('text=SSH')).toBeVisible()
    await expect(page.locator('code', { hasText: '0 8 * * *' })).toBeVisible()
  })

  test('AC-LIST-3: Playbook-Job zeigt Playbook-Badge', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_PLAYBOOK_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Wöchentlicher Playbook-Run')).toBeVisible()
    await expect(page.getByText('Playbook', { exact: true })).toBeVisible()
  })

  test('AC-LIST-4: Power-Action-Job zeigt Power-Badge und Zeitfenster-Badge', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_POWER_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=VM Start/Stop Fenster')).toBeVisible()
    await expect(page.getByText('Power', { exact: true })).toBeVisible()
    await expect(page.getByText('Fenster', { exact: true })).toBeVisible()
  })

  test('AC-LIST-5: Inaktiver Job erscheint in der Tabelle mit reduzierter Opazität', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_POWER_JOB])
    await gotoScheduledJobs(page)

    // Inaktiver Job hat opacity-60 Klasse
    const row = page.locator('tr', { has: page.locator('text=VM Start/Stop Fenster') })
    await expect(row).toHaveClass(/opacity-60/)
  })

  test('AC-LIST-6: Erfolgreicher letzter Run zeigt ✅', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=✅')).toBeVisible()
  })

  test('AC-LIST-7: Fehlgeschlagener letzter Run zeigt ❌', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_POWER_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=❌')).toBeVisible()
  })

  test('AC-LIST-8: Mehrere Jobs werden alle in der Tabelle angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB, MOCK_PLAYBOOK_JOB, MOCK_POWER_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Täglicher Patch-Check')).toBeVisible()
    await expect(page.locator('text=Wöchentlicher Playbook-Run')).toBeVisible()
    await expect(page.locator('text=VM Start/Stop Fenster')).toBeVisible()
  })

  test('AC-LIST-9: Nächster geplanter Run wird unterhalb des Cron-Ausdrucks angezeigt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Nächster:')).toBeVisible()
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// 2. Permission-Gate
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – Berechtigungsprüfung', () => {

  test('AC-PERM-1: Viewer ohne manage_scheduled_jobs kann nicht auf /scheduled-jobs zugreifen', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, 'viewer')
    await page.route('/api/scheduled-jobs', r => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Forbidden' }) }))
    await page.goto('/scheduled-jobs')
    await page.waitForTimeout(400)

    // ProtectedRoute leitet weiter, oder zeigt Forbidden-Message
    const url = page.url()
    const noAccess = url.includes('/scheduled-jobs') === false ||
      (await page.locator('text=Scheduled Jobs').count()) === 0
    // Entweder zur Login-Seite weitergeleitet oder keine Jobs-Seite sichtbar
    expect(url.includes('/login') || url === 'about:blank' || noAccess).toBeTruthy()
  })

  test('AC-PERM-2: Sidebar-Link "Scheduled Jobs" fehlt für Viewer ohne Permission', async ({ page }) => {
    await setupViewer(page)
    await mockCommon(page, 'viewer')
    await page.goto('/')
    await page.waitForTimeout(500)

    // Scheduled Jobs Link sollte in der Sidebar nicht erscheinen
    const sidebar = page.locator('nav')
    await expect(sidebar.locator('a[href="/scheduled-jobs"]')).toHaveCount(0)
  })

  test('AC-PERM-3: Admin sieht Sidebar-Link "Scheduled Jobs"', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await page.goto('/')
    await page.waitForTimeout(500)

    const sidebar = page.locator('nav')
    await expect(sidebar.locator('a[href="/scheduled-jobs"]')).toHaveCount(1)
  })

  test('AC-PERM-4: Operator mit manage_scheduled_jobs sieht Sidebar-Link', async ({ page }) => {
    await setupOperator(page)
    await mockCommon(page, 'operator')
    await mockScheduledJobs(page, [])
    await page.goto('/')
    await page.waitForTimeout(500)

    const sidebar = page.locator('nav')
    await expect(sidebar.locator('a[href="/scheduled-jobs"]')).toHaveCount(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// 3. Job anlegen – Typ-Auswahl (3-Schritt-Wizard)
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – Job anlegen (Wizard)', () => {

  test('AC-CREATE-1: "Neuer Job"-Button öffnet Modal mit Typ-Auswahl (Schritt 1 von 3)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()

    await expect(page.locator('text=Neuer Scheduled Job')).toBeVisible()
    await expect(page.locator('text=Schritt 1 von 3')).toBeVisible()
    await expect(page.getByText('Ansible Playbook', { exact: true })).toBeVisible()
    await expect(page.getByText('SSH-Befehl', { exact: true })).toBeVisible()
    await expect(page.getByText('VM/LXC Power-Aktion', { exact: true })).toBeVisible()
  })

  test('AC-CREATE-2: SSH-Typ auswählen öffnet Schritt 2 mit SSH-Feldern', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()

    await expect(page.locator('text=Schritt 2 von 3')).toBeVisible()
    await expect(page.locator('text=Ziel')).toBeVisible()
    await expect(page.getByPlaceholder('root@192.168.1.100')).toBeVisible()
    await expect(page.getByPlaceholder('apt list --upgradable')).toBeVisible()
    await expect(page.locator('text=SSH-Key-Quelle')).toBeVisible()
    await expect(page.locator('text=Timeout')).toBeVisible()
  })

  test('AC-CREATE-3: Zurück-Button kehrt von Schritt 2 zu Schritt 1 zurück', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await expect(page.locator('text=Schritt 2 von 3')).toBeVisible()

    await page.getByRole('button', { name: 'Zurück' }).click()
    await expect(page.locator('text=Schritt 1 von 3')).toBeVisible()
    await expect(page.getByText('Ansible Playbook', { exact: true })).toBeVisible()
  })

  test('AC-CREATE-4: "Weiter" von Schritt 2 führt zu Schritt 3 (Zeitplan + Meta)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await page.getByPlaceholder('root@192.168.1.100').fill('root@192.168.1.10')
    await page.getByPlaceholder('apt list --upgradable').fill('uptime')
    await page.getByRole('button', { name: 'Weiter' }).click()

    await expect(page.locator('text=Schritt 3 von 3')).toBeVisible()
    await expect(page.getByPlaceholder('Täglicher Patch-Check')).toBeVisible()
    await expect(page.locator('text=Job sofort aktivieren')).toBeVisible()
  })

  test('AC-CREATE-5: Validierung schlägt fehl wenn Name fehlt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await page.getByPlaceholder('root@192.168.1.100').fill('root@192.168.1.10')
    await page.getByPlaceholder('apt list --upgradable').fill('uptime')
    await page.getByRole('button', { name: 'Weiter' }).click()
    // Name leer lassen
    await page.getByRole('button', { name: 'Job erstellen' }).click()

    await expect(page.locator('text=Name ist erforderlich.')).toBeVisible()
  })

  test('AC-CREATE-6: Validierung schlägt fehl bei falschem user@host-Format', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await page.getByPlaceholder('root@192.168.1.100').fill('ungültiges-format')
    await page.getByPlaceholder('apt list --upgradable').fill('uptime')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await page.getByPlaceholder('Täglicher Patch-Check').fill('Test Job')
    await page.getByRole('button', { name: 'Job erstellen' }).click()

    await expect(page.locator('text=Format: user@host')).toBeVisible()
  })

  test('AC-CREATE-7: Intervall-Dropdown bietet vordefinierte Zeitpläne an', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await page.getByPlaceholder('root@192.168.1.100').fill('root@192.168.1.10')
    await page.getByPlaceholder('apt list --upgradable').fill('uptime')
    await page.getByRole('button', { name: 'Weiter' }).click()

    // CronPicker select (first select is the schedule type)
    const select = page.locator('select').first()
    await expect(select.locator('option', { hasText: 'Alle 15 Minuten' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: 'Stündlich' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: 'Täglich' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: 'Wöchentlich' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: 'Eigener Cron-Ausdruck…' })).toHaveCount(1)
  })

  test('AC-CREATE-8: "Eigener Cron-Ausdruck" zeigt Freitext-Eingabefeld', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await page.getByPlaceholder('root@192.168.1.100').fill('root@192.168.1.10')
    await page.getByPlaceholder('apt list --upgradable').fill('uptime')
    await page.getByRole('button', { name: 'Weiter' }).click()

    await page.locator('select').selectOption('custom')
    await expect(page.getByPlaceholder('0 */6 * * *')).toBeVisible()
  })

  test('AC-CREATE-9: Abbrechen schließt Modal ohne Änderung', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await expect(page.locator('text=Neuer Scheduled Job')).toBeVisible()

    await page.getByRole('button', { name: 'Abbrechen' }).click()
    await expect(page.locator('text=Neuer Scheduled Job')).not.toBeVisible()
    await expect(page.locator('text=Noch keine Scheduled Jobs vorhanden.')).toBeVisible()
  })

  test('AC-CREATE-10: Erfolgreiche Job-Erstellung schließt Modal und lädt Liste neu', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await page.route('/api/scheduled-jobs', async (route, request) => {
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_SSH_JOB, id: 99, name: 'Neuer SSH Job' }),
        })
      } else {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify([{ ...MOCK_SSH_JOB, id: 99, name: 'Neuer SSH Job' }]),
        })
      }
    })

    await page.getByRole('button', { name: 'Neuer Job' }).click()
    await page.getByText('SSH-Befehl', { exact: true }).click()
    await page.getByPlaceholder('root@192.168.1.100').fill('root@192.168.1.10')
    await page.getByPlaceholder('apt list --upgradable').fill('uptime')
    await page.getByRole('button', { name: 'Weiter' }).click()
    await page.getByPlaceholder('Täglicher Patch-Check').fill('Neuer SSH Job')
    await page.getByRole('button', { name: 'Job erstellen' }).click()
    await page.waitForTimeout(500)

    await expect(page.locator('text=Neuer Scheduled Job')).not.toBeVisible()
    await expect(page.locator('text=Neuer SSH Job')).toBeVisible()
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// 4. Detail-Modal & Run-History
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – Detail-Modal & Run-History', () => {

  test('AC-DETAIL-1: Klick auf Job-Name öffnet Detail-Modal mit Konfiguration', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await mockScheduledJobRuns(page, 1, MOCK_RUNS)
    await mockScheduledJobDetail(page, MOCK_SSH_JOB)
    await gotoScheduledJobs(page)

    await page.locator('text=Täglicher Patch-Check').first().click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=Konfiguration')).toBeVisible()
    await expect(page.locator('text=root@192.168.1.10')).toBeVisible()
    await expect(page.locator('text=apt list --upgradable')).toBeVisible()
  })

  test('AC-DETAIL-2: Detail-Modal zeigt Run-History-Abschnitt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await mockScheduledJobRuns(page, 1, MOCK_RUNS)
    await mockScheduledJobDetail(page, MOCK_SSH_JOB)
    await gotoScheduledJobs(page)

    await page.locator('text=Täglicher Patch-Check').first().click()
    await page.waitForTimeout(500)

    await expect(page.locator('text=Run-History')).toBeVisible()
  })

  test('AC-DETAIL-3: Detail-Modal zeigt Typ-Badge und Job-Status (pausiert)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_POWER_JOB])
    await mockScheduledJobRuns(page, 3, [])
    await mockScheduledJobDetail(page, MOCK_POWER_JOB)
    await gotoScheduledJobs(page)

    await page.locator('text=VM Start/Stop Fenster').first().click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=pausiert')).toBeVisible()
    await expect(page.locator('text=Power-Aktion')).toBeVisible()
  })

  test('AC-DETAIL-4: Detail-Modal lässt sich schließen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await mockScheduledJobRuns(page, 1, MOCK_RUNS)
    await mockScheduledJobDetail(page, MOCK_SSH_JOB)
    await gotoScheduledJobs(page)

    await page.locator('text=Täglicher Patch-Check').first().click()
    await page.waitForTimeout(300)
    await expect(page.locator('text=Konfiguration')).toBeVisible()

    await page.getByRole('button', { name: 'Schließen' }).click()
    await expect(page.locator('text=Konfiguration')).not.toBeVisible()
  })

  test('AC-DETAIL-5: Detail-Modal für SSH-Job zeigt Stop-Zeitplan des Child-Jobs (Zeitfenster)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_POWER_JOB])
    await mockScheduledJobRuns(page, 3, [])
    await mockScheduledJobDetail(page, MOCK_POWER_JOB)
    await gotoScheduledJobs(page)

    await page.locator('text=VM Start/Stop Fenster').first().click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=Stop-Zeitplan')).toBeVisible()
    await expect(page.locator('text=0 20 * * 1-5')).toBeVisible()
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// 5. Job-Aktionen (Toggle, Delete, Run)
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – Job-Aktionen', () => {

  test('AC-ACTION-1: "Jetzt ausführen"-Button sendet POST /{id}/run', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])

    let runCalled = false
    await page.route('/api/scheduled-jobs/1/run', r => {
      if (r.request().method() === 'POST') { runCalled = true }
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'Dispatched' }) })
    })
    await gotoScheduledJobs(page)

    // Play-Button (Dreieck-Icon) anklicken
    const playBtn = page.locator('button[title="Jetzt ausführen"]').first()
    await playBtn.click()
    await page.waitForTimeout(400)

    expect(runCalled).toBe(true)
  })

  test('AC-ACTION-2: Toggle-Button sendet POST /{id}/toggle', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])

    let toggleCalled = false
    await page.route('/api/scheduled-jobs/1/toggle', r => {
      if (r.request().method() === 'POST') { toggleCalled = true }
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...MOCK_SSH_JOB, active: false }) })
    })
    await gotoScheduledJobs(page)

    const toggleBtn = page.locator('button[title="Pausieren"]').first()
    await toggleBtn.click()
    await page.waitForTimeout(400)

    expect(toggleCalled).toBe(true)
  })

  test('AC-ACTION-3: Bearbeiten-Button öffnet Edit-Modal', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await gotoScheduledJobs(page)

    await page.locator('button[title="Bearbeiten"]').first().click()
    await page.waitForTimeout(200)

    await expect(page.locator('text=Job bearbeiten')).toBeVisible()
    // Beim Bearbeiten kein Schritt-1-Screen (direkt auf Schritt 2)
    await expect(page.locator('text=Schritt 1 von 3')).not.toBeVisible()
  })

  test('AC-ACTION-4: Löschen mit Bestätigung sendet DELETE /{id}', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])

    let deleteCalled = false
    await page.route('/api/scheduled-jobs/1', r => {
      if (r.request().method() === 'DELETE') { deleteCalled = true }
      r.fulfill({ status: 204 })
    })
    await gotoScheduledJobs(page)

    page.on('dialog', d => d.accept())
    await page.locator('button[title="Löschen"]').first().click()
    await page.waitForTimeout(400)

    expect(deleteCalled).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// 6. Admin-Settings: System-SSH-Key & History-Limit
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – Admin-Settings (Scheduled Jobs)', () => {

  test('AC-SETTINGS-1: Admin-Settings zeigen "Scheduled Jobs"-Tab', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockSettings(page)
    await page.goto('/admin/settings')
    await page.waitForTimeout(400)

    await expect(page.getByRole('button', { name: 'Scheduled Jobs' })).toBeVisible()
  })

  test('AC-SETTINGS-2: System-SSH-Key-Bereich zeigt "Kein System-SSH-Key hinterlegt" wenn kein Key gesetzt', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockSettings(page, MOCK_SETTINGS)
    await page.goto('/admin/settings')
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'Scheduled Jobs' }).click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=Kein System-SSH-Key hinterlegt.')).toBeVisible()
  })

  test('AC-SETTINGS-3: "Hinterlegen"-Button öffnet SSH-Key-Textarea', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockSettings(page, MOCK_SETTINGS)
    await page.goto('/admin/settings')
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'Scheduled Jobs' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Hinterlegen' }).click()

    await expect(page.locator('textarea')).toBeVisible()
    await expect(page.getByPlaceholder('-----BEGIN OPENSSH PRIVATE KEY-----')).toBeVisible()
  })

  test('AC-SETTINGS-4: System-SSH-Key gesetzt zeigt Maskierung "••••••• (gesetzt)"', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockSettings(page, MOCK_SETTINGS_WITH_KEY)
    await page.goto('/admin/settings')
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'Scheduled Jobs' }).click()
    await page.waitForTimeout(300)

    await expect(page.locator('text=••••••• (gesetzt)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entfernen' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ändern' })).toBeVisible()
  })

  test('AC-SETTINGS-5: Run-History-Limit-Feld ist vorhanden und editierbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockSettings(page, MOCK_SETTINGS)
    await page.goto('/admin/settings')
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'Scheduled Jobs' }).click()
    await page.waitForTimeout(300)

    const limitInput = page.locator('input[type="number"]').first()
    await expect(limitInput).toBeVisible()
    await expect(limitInput).toHaveValue('20')
  })

  test('AC-SETTINGS-6: History-Limit-Validierung zeigt Fehler bei ungültigem Wert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockSettings(page, MOCK_SETTINGS)
    await page.goto('/admin/settings')
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'Scheduled Jobs' }).click()
    await page.waitForTimeout(300)

    const limitInput = page.locator('input[type="number"]').first()
    await limitInput.fill('0')
    await page.getByRole('button', { name: 'Speichern' }).first().click()

    await expect(page.locator('text=Wert zwischen 1 und 1000.')).toBeVisible()
  })
})

// ════════════════════════════════════════════════════════════════════════════════
// 7. Info-Box & Tipp
// ════════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-35 – UI-Details', () => {

  test('AC-UI-1: Tipp-Box erscheint wenn keine Jobs vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Scheduled Jobs laufen automatisch auf einem Zeitplan.')).toBeVisible()
  })

  test('AC-UI-2: Tipp-Box erscheint NICHT wenn Jobs vorhanden sind', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [MOCK_SSH_JOB])
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Scheduled Jobs laufen automatisch auf einem Zeitplan.')).not.toBeVisible()
  })

  test('AC-UI-3: Seitentitel "Scheduled Jobs" ist sichtbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockScheduledJobs(page, [])
    await gotoScheduledJobs(page)

    await expect(page.locator('h1', { hasText: 'Scheduled Jobs' })).toBeVisible()
  })

  test('AC-UI-4: Ladeindikator erscheint während Jobs geladen werden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)

    // Verzögerung beim Job-Laden
    await page.route('/api/scheduled-jobs', async r => {
      await new Promise(res => setTimeout(res, 300))
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/scheduled-jobs')
    await expect(page.locator('text=Lädt Scheduled Jobs…')).toBeVisible()
    await page.waitForTimeout(600)
    await expect(page.locator('text=Lädt Scheduled Jobs…')).not.toBeVisible()
  })

  test('AC-UI-5: Fehler-Zustand zeigt "Fehler beim Laden" mit Retry-Button', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await page.route('/api/scheduled-jobs', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Server error' }) }))
    await gotoScheduledJobs(page)

    await expect(page.locator('text=Fehler beim Laden der Jobs.')).toBeVisible()
    await expect(page.locator('text=Erneut versuchen')).toBeVisible()
  })
})
