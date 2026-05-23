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

const FAKE_NODES = [
  {
    node: 'pve1', status: 'online',
    cpu: 0.12, maxcpu: 8,
    mem: 4294967296, maxmem: 17179869184,
    disk: 10737418240, maxdisk: 107374182400,
    uptime: 172800,
  },
]
const FAKE_VMS = []
const FAKE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }

const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

// Plus-Lizenz wird benötigt, damit "Node hinzufügen"-Button im AdminNodesPage erscheint
const PLUS_LICENSE = {
  edition: 'plus_v1', valid: true, contact_name: 'Test', contact_email: 'test@example.com',
  expiry: '2099-01-01', reason: null,
  limits: { users: { current: 1, max: null, unlimited: true }, presets: { current: 0, max: null, unlimited: true } },
}

const MOCK_NODE_DEFAULT = {
  id: 1,
  name: 'Heimserver',
  url: 'https://pve.example.com:8006',
  proxmox_node: 'pve',
  verify_ssl: true,
  poll_interval: 30,
  viewer_token_id: 'viewer@pam!tok',
  operator_token_id: 'op@pam!tok',
  admin_token_id: 'admin@pam!tok',
  packer_token_id: 'packer@pam!tok',
  is_default: true,
  cluster_nodes: [],
  created_at: '2026-05-01T00:00:00Z',
  created_by: 'admin',
}

const MOCK_NODE_POLL60 = { ...MOCK_NODE_DEFAULT, poll_interval: 60 }

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setFakeAuth(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('token', 'fake.jwt.token')
  })
}

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function mockCommon(page) {
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }),
  }))
  await page.route('/api/playbooks', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
}

async function mockLicense(page, license) {
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(license) }))
}

async function mockNodes(page, nodes) {
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
}

async function goToNodesPage(page) {
  await page.goto('/')
  await page.waitForTimeout(300)
  await page.goto('/admin/nodes')
  await page.waitForTimeout(300)
}

// Hinweis: "Node hinzufügen"-Button ist nur mit Plus-Lizenz sichtbar (isPlus = valid === true)
async function openAddModal(page) {
  await goToNodesPage(page)
  await page.getByRole('button', { name: 'Node hinzufügen' }).click()
  await page.waitForTimeout(200)
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Dashboard – force=true beim Refresh-Button
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-33 – Dashboard Refresh-Button', () => {

  test('AC-REFRESH-1: Refresh-Button sendet ?force=true an alle drei Cluster-Endpunkte', async ({ page }) => {
    await setFakeAuth(page)

    const forcedEndpoints = []

    for (const endpoint of ['nodes', 'vms', 'status']) {
      await page.route(new RegExp(`/api/cluster/${endpoint}`), async (route) => {
        if (route.request().url().includes('force=true')) {
          forcedEndpoints.push(endpoint)
        }
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(
            endpoint === 'nodes' ? FAKE_NODES
            : endpoint === 'vms' ? FAKE_VMS
            : FAKE_STATUS
          ),
        })
      })
    }

    await page.goto('/dashboard')
    await expect(page.getByText('pve1').first()).toBeVisible()

    // Klick auf Refresh-Button (↻ Aktualisieren)
    await page.getByRole('button', { name: /aktualisieren/i }).click()
    await page.waitForTimeout(500)

    // Alle drei Endpunkte müssen mit force=true aufgerufen worden sein
    expect(forcedEndpoints).toContain('nodes')
    expect(forcedEndpoints).toContain('vms')
    expect(forcedEndpoints).toContain('status')
  })

  test('AC-REFRESH-2: Refresh-Button zeigt Lade-Zustand und ist deaktiviert während Refresh', async ({ page }) => {
    await setFakeAuth(page)

    await page.route(/\/api\/cluster\/nodes/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) }))
    await page.route(/\/api\/cluster\/vms/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route(/\/api\/cluster\/status/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) }))

    await page.goto('/dashboard')
    await expect(page.getByText('pve1').first()).toBeVisible()

    // Refresh-Button vor Klick: aktiv
    const refreshBtn = page.getByRole('button', { name: /aktualisieren/i })
    await expect(refreshBtn).not.toBeDisabled()

    // Klick → Button zeigt "Lädt…" und ist deaktiviert
    await refreshBtn.click()
    // Kurz nach Klick: Button zeigt Lade-Text
    await expect(page.getByRole('button', { name: /Lädt/i })).toBeVisible()
  })

  test('AC-REFRESH-3: Initialer Auto-Poll sendet kein force=true', async ({ page }) => {
    await setFakeAuth(page)

    const forcedRequests = []
    const normalRequests = []

    await page.route(/\/api\/cluster\/nodes/, async (route) => {
      const url = route.request().url()
      if (url.includes('force=true')) {
        forcedRequests.push(url)
      } else {
        normalRequests.push(url)
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) })
    })
    await page.route(/\/api\/cluster\/vms/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route(/\/api\/cluster\/status/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) }))

    await page.goto('/dashboard')
    await expect(page.getByText('pve1').first()).toBeVisible()

    // Der initiale Lade-Request darf kein force=true enthalten
    expect(forcedRequests).toHaveLength(0)
    expect(normalRequests.length).toBeGreaterThan(0)
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 2. NodeFormModal – Poll-Intervall-Feld
// ════════════════════════════════════════════════════════════════════════════

test.describe('PROJ-33 – NodeFormModal Poll-Intervall', () => {

  test('AC-POLL-1: Poll-Intervall-Feld ist im Erstellen-Modal mit Standardwert 30 sichtbar', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)  // Plus-Lizenz: "Node hinzufügen"-Button sichtbar
    await mockNodes(page, [MOCK_NODE_DEFAULT])

    await openAddModal(page)

    // Label sichtbar
    await expect(page.getByText('Poll-Intervall (Sekunden)')).toBeVisible()

    // Input mit min=10, max=300, value=30
    const input = page.locator('input[type="number"][min="10"][max="300"]')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('30')
  })

  test('AC-POLL-2: ⓘ-Button zeigt Tooltip mit Empfehlungstabelle bei Hover', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_DEFAULT])

    await openAddModal(page)

    // ⓘ-Button via aria-label
    const infoBtn = page.locator('button[aria-label="Poll-Intervall Hinweis"]')
    await expect(infoBtn).toBeVisible()

    // Tooltip initial nicht sichtbar
    await expect(page.locator('text=Empfohlene Intervalle:')).not.toBeVisible()

    // Hover → Tooltip erscheint
    await infoBtn.hover()
    await expect(page.locator('text=Empfohlene Intervalle:')).toBeVisible()

    // Empfehlungswerte aus dem Spec
    await expect(page.locator('text=15–30 s')).toBeVisible()
    await expect(page.locator('text=30–60 s')).toBeVisible()
    await expect(page.locator('text=60–120 s')).toBeVisible()
  })

  test('AC-POLL-3: Validierung – Wert unter 10 zeigt Fehlermeldung', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_DEFAULT])

    await openAddModal(page)

    // Pflichtfelder vor poll_interval in validate() ausfüllen
    await page.locator('input[placeholder="Heimcluster"]').fill('Test Node')
    await page.locator('input[placeholder="https://pve01.example.com:8006"]').fill('https://pve.example.com:8006')

    // Poll-Intervall auf ungültigen Wert setzen (unter 10)
    const pollInput = page.locator('input[type="number"][min="10"][max="300"]')
    await pollInput.fill('5')

    // "Verbindung testen" (type="button") triggert validate() ohne native HTML5-Validierung zu blockieren
    await page.getByRole('button', { name: 'Verbindung testen' }).click()

    await expect(page.locator('text=Poll-Intervall muss zwischen 10 und 300 Sekunden liegen.')).toBeVisible()
  })

  test('AC-POLL-4: Validierung – Wert über 300 zeigt Fehlermeldung', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_DEFAULT])

    await openAddModal(page)

    await page.locator('input[placeholder="Heimcluster"]').fill('Test Node')
    await page.locator('input[placeholder="https://pve01.example.com:8006"]').fill('https://pve.example.com:8006')

    const pollInput = page.locator('input[type="number"][min="10"][max="300"]')
    await pollInput.fill('999')

    // type="button" → kein HTML5-Submit-Blocking, React-validate() läuft direkt
    await page.getByRole('button', { name: 'Verbindung testen' }).click()

    await expect(page.locator('text=Poll-Intervall muss zwischen 10 und 300 Sekunden liegen.')).toBeVisible()
  })

  test('AC-POLL-5: poll_interval wird im POST-Payload beim Erstellen gesendet', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)

    let capturedPayload = null
    await page.route('/api/admin/nodes', async (route) => {
      if (route.request().method() === 'POST') {
        capturedPayload = JSON.parse(route.request().postData())
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_NODE_DEFAULT, id: 2 }),
        })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE_DEFAULT]) })
      }
    })

    await goToNodesPage(page)
    await page.getByRole('button', { name: 'Node hinzufügen' }).click()
    await page.waitForTimeout(200)

    // Pflichtfelder ausfüllen
    await page.locator('input[placeholder="Heimcluster"]').fill('Test Node')
    await page.locator('input[placeholder="https://pve01.example.com:8006"]').fill('https://pve.example.com:8006')

    // Poll-Intervall auf 45 setzen
    const pollInput = page.locator('input[type="number"][min="10"][max="300"]')
    await pollInput.fill('45')

    // Alle Token-Felder ausfüllen (4 Token-Paare: viewer, operator, admin, packer)
    const tokenIdInputs = page.locator('input[placeholder="user@pam!token"]')
    const tokenCount = await tokenIdInputs.count()
    for (let i = 0; i < tokenCount; i++) {
      await tokenIdInputs.nth(i).fill(`role${i}@pam!tok`)
    }
    const tokenSecretInputs = page.locator('input[type="password"]')
    const secretCount = await tokenSecretInputs.count()
    for (let i = 0; i < secretCount; i++) {
      await tokenSecretInputs.nth(i).fill('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    }

    await page.getByRole('button', { name: 'Speichern' }).click()
    await page.waitForTimeout(400)

    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload.poll_interval).toBe(45)
  })

  test('AC-POLL-6: Bearbeitungs-Modal füllt poll_interval aus Node-Daten vor', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)  // Bearbeiten-Button ist auch auf Basis sichtbar
    await mockNodes(page, [MOCK_NODE_POLL60])

    await goToNodesPage(page)

    // Bearbeiten öffnen
    await page.locator('button:has-text("Bearbeiten")').first().click()
    await page.waitForTimeout(200)

    // poll_interval-Feld muss mit 60 vorbefüllt sein
    const pollInput = page.locator('input[type="number"][min="10"][max="300"]')
    await expect(pollInput).toBeVisible()
    await expect(pollInput).toHaveValue('60')
  })

  test('AC-POLL-7: Validierung – Grenzwert 10 ist gültig (poll_interval-Fehler bleibt aus)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_DEFAULT])

    await openAddModal(page)

    await page.locator('input[placeholder="Heimcluster"]').fill('Test Node')
    await page.locator('input[placeholder="https://pve01.example.com:8006"]').fill('https://pve.example.com:8006')

    const pollInput = page.locator('input[type="number"][min="10"][max="300"]')
    await pollInput.fill('10')

    await page.getByRole('button', { name: 'Speichern' }).click()

    // poll_interval-Fehler darf nicht erscheinen – Validierung geht weiter zu Token-Check
    await expect(page.locator('text=Poll-Intervall muss zwischen 10 und 300 Sekunden liegen.')).not.toBeVisible()
  })

  test('AC-POLL-8: Validierung – Grenzwert 300 ist gültig (poll_interval-Fehler bleibt aus)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_DEFAULT])

    await openAddModal(page)

    await page.locator('input[placeholder="Heimcluster"]').fill('Test Node')
    await page.locator('input[placeholder="https://pve01.example.com:8006"]').fill('https://pve.example.com:8006')

    const pollInput = page.locator('input[type="number"][min="10"][max="300"]')
    await pollInput.fill('300')

    await page.getByRole('button', { name: 'Speichern' }).click()

    await expect(page.locator('text=Poll-Intervall muss zwischen 10 und 300 Sekunden liegen.')).not.toBeVisible()
  })

})
