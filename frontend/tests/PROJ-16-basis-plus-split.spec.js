// p3portal.org
import { test, expect } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// ── Token-Fixture ─────────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator1","auth_type":"local","role":"operator","exp":9999999999,"jti":"op16"}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OSwianRpIjoib3AxNiJ9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

// Basis-Edition: genau 1 Node (Cluster-Format mit `node`-Feld)
const SINGLE_NODE = [
  { node: 'pve1', status: 'online', cpu: 0.35, maxcpu: 8, mem: 8589934592, maxmem: 17179869184, disk: 0, maxdisk: 0, uptime: 86400 },
]
const SINGLE_NODE_OFFLINE = [
  { node: 'pve1', status: 'offline', cpu: 0.0, maxcpu: 8, mem: 0, maxmem: 17179869184, disk: 0, maxdisk: 0, uptime: 0 },
]

// Packer-Nodes-Format (name-Feld, nicht node-Feld)
const PACKER_SINGLE_NODE = [{ name: 'pve1', status: 'online' }]
const SINGLE_NODE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }
const OFFLINE_NODE_STATUS  = { quorum: false, node_count: 1, ha_status: 'none' }

// Packer-Template mit node-Parameter
const PACKER_TEMPLATES = [
  { id: 'debian-16', name: 'Debian 16 Template', description: 'Debian Trixie (PROJ-16 Test)', required_role: 'operator' },
]

const PACKER_TEMPLATE_DETAIL = {
  id: 'debian-16',
  name: 'Debian 16 Template',
  description: 'Debian Trixie (PROJ-16 Test)',
  required_role: 'operator',
  parameters: [
    { id: 'node', label: 'Proxmox Node', type: 'string', required: true, default: null },
    { id: 'vm_id', label: 'VM ID', type: 'integer', required: true, min: 100, max: 999999999, default: null },
  ],
}

const REPO_ROOT = join(import.meta.dirname, '..', '..')

// ── Helpers ───────────────────────────────────────────────────────────────────

async function mockCluster(page, nodes = SINGLE_NODE, status = SINGLE_NODE_STATUS) {
  await page.route('**/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }))
  await page.route('**/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

// Dashboard-Seite mit Auth laden (addInitScript = token vor React-Start)
async function goDashboard(page, nodes = SINGLE_NODE, status = SINGLE_NODE_STATUS) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OPERATOR_TOKEN)
  await mockCluster(page, nodes, status)
  await page.goto('/dashboard')
}

// Packer-Seite mit Auth laden
async function goPackerPage(page, packerNodes = PACKER_SINGLE_NODE) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OPERATOR_TOKEN)
  await page.route('/api/packer/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(packerNodes) }))
  await page.route('/api/packer/debian-16', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACKER_TEMPLATE_DETAIL) }))
  await page.route('/api/packer', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PACKER_TEMPLATES) }))
  await page.route('/api/jobs', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/cluster/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.goto('/packer')
}

// ── Lizenz-Struktur (statische Datei-Checks) ──────────────────────────────────

test.describe('PROJ-16 – Lizenz-Struktur', () => {

  test('LC1: LICENSE im Repo-Root enthält AGPLv3-Volltext', () => {
    const path = join(REPO_ROOT, 'LICENSE')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('GNU AFFERO GENERAL PUBLIC LICENSE')
    expect(content).toContain('Version 3')
  })

  test('LC2: LICENSE-PLUS im Repo-Root enthält Commons Clause + MIT', () => {
    const path = join(REPO_ROOT, 'LICENSE-PLUS')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('Commons Clause')
    expect(content).toContain('MIT')
  })

  test('LC3: backend/plus/README.md existiert mit Hinweis auf LICENSE-PLUS', () => {
    const path = join(REPO_ROOT, 'backend', 'plus', 'README.md')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('LICENSE-PLUS')
  })

  test('LC4: frontend/plus/README.md existiert mit Hinweis auf LICENSE-PLUS', () => {
    const path = join(REPO_ROOT, 'frontend', 'plus', 'README.md')
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('LICENSE-PLUS')
  })

})

// ── ClusterStatusBar – Single-Node-Ansicht (Basis) ───────────────────────────

test.describe('PROJ-16 – ClusterStatusBar Single-Node-Modus', () => {

  test('SN1: ClusterStatusBar zeigt Node-Name wenn nur 1 Node zurückkommt', async ({ page }) => {
    await goDashboard(page)
    // Wait until status bar has loaded data (CPU% appears as reliable signal)
    await expect(page.getByText('CPU 35%')).toBeVisible()
    await expect(page.getByText('pve1').first()).toBeVisible()
  })

  test('SN2: StatusBar zeigt "Online" (case-sensitiv, nicht "Cluster OK" / "HA inaktiv")', async ({ page }) => {
    await goDashboard(page)
    await expect(page.getByText('CPU 35%')).toBeVisible() // wait for bar to load

    // Regex ^Online$ ist case-sensitiv → matcht nur "Online", nicht NodeCard "online"
    await expect(page.getByText(/^Online$/)).toBeVisible()
    await expect(page.getByText('Cluster OK')).not.toBeVisible()
    await expect(page.getByText('HA inaktiv')).not.toBeVisible()
    await expect(page.getByText('Kein Quorum')).not.toBeVisible()
  })

  test('SN3: ClusterStatusBar zeigt CPU% des einzelnen Nodes', async ({ page }) => {
    await goDashboard(page)
    // cpu=0.35 → 35%
    await expect(page.getByText('CPU 35%')).toBeVisible()
  })

  test('SN4: ClusterStatusBar zeigt RAM% des einzelnen Nodes', async ({ page }) => {
    await goDashboard(page)
    // mem=8589934592 / maxmem=17179869184 = 50%
    await expect(page.getByText('RAM 50%')).toBeVisible()
  })

  test('SN5: ClusterStatusBar zeigt keinen "X/Y Nodes" Counter', async ({ page }) => {
    await goDashboard(page)
    await expect(page.getByText('CPU 35%')).toBeVisible() // wait for bar to load
    await expect(page.getByText(/\d+\/\d+ Nodes/)).not.toBeVisible()
  })

  test('SN6: ClusterStatusBar zeigt "Offline" (case-sensitiv) wenn Node offline', async ({ page }) => {
    await goDashboard(page, SINGLE_NODE_OFFLINE, OFFLINE_NODE_STATUS)
    // Kein CPU/RAM bei offline → warte auf Node-Name statt CPU%
    await expect(page.getByText('pve1').first()).toBeVisible()

    // Regex ^Offline$ matcht nur "Offline" (capital), nicht NodeCard "offline" (lowercase)
    await expect(page.getByText(/^Offline$/)).toBeVisible()
    await expect(page.getByText(/^Online$/)).not.toBeVisible()
  })

})

// ── PackerBuildForm – Node-Dropdown Ausblendung (Basis) ──────────────────────

test.describe('PROJ-16 – PackerBuildForm Node-Dropdown Basis-Edition', () => {

  test('PK1: Node-Dropdown wird nicht angezeigt wenn nur 1 Node (Basis)', async ({ page }) => {
    await goPackerPage(page)

    // Warten bis Template-Liste geladen ist
    await expect(page.getByText('Debian 16 Template')).toBeVisible({ timeout: 8000 })
    await page.getByText('Debian 16 Template').click()

    // Warten bis Formular erscheint (VM ID Label vorhanden)
    await expect(page.locator('label:has-text("VM ID")')).toBeVisible()

    // Kein "Proxmox Node" Label sichtbar – auto-ausgewählt und ausgeblendet
    await expect(page.locator('label:has-text("Proxmox Node")')).not.toBeVisible()
  })

  test('PK2: Formular-Submission sendet node=pve1 ohne sichtbaren Dropdown', async ({ page }) => {
    await goPackerPage(page)

    let capturedBody = null
    await page.route('/api/packer/debian-16/build', async (r) => {
      capturedBody = r.request().postDataJSON()
      await r.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({ id: 'job-p16', type: 'packer', status: 'pending', created_at: new Date().toISOString() }),
      })
    })
    await page.route('/api/jobs/job-p16', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        id: 'job-p16', type: 'packer', status: 'pending', created_at: new Date().toISOString(),
      })}))

    await page.getByText('Debian 16 Template').click()
    await expect(page.locator('label:has-text("VM ID")')).toBeVisible()

    // VM ID ausfüllen (input[type=number], da kein htmlFor auf label)
    await page.locator('input[type="number"]').first().fill('500')
    await page.locator('button:has-text("Build starten")').click()

    await page.waitForURL('**/jobs/**', { timeout: 10000 })

    // node muss auto-gesetzt sein (pve1 aus 1-Node-Liste)
    // API sendet { params: { node, vm_id, ... } }
    expect(capturedBody).not.toBeNull()
    expect(capturedBody.params.node).toBe('pve1')
    expect(String(capturedBody.params.vm_id)).toBe('500')
  })

  test('PK3: Node-Dropdown erscheint wenn mehrere Nodes zurückkommen (Plus-Modus)', async ({ page }) => {
    const MULTI_NODES = [
      { name: 'pve1', status: 'online' },
      { name: 'pve2', status: 'online' },
    ]
    await goPackerPage(page, MULTI_NODES)

    await page.getByText('Debian 16 Template').click()
    await expect(page.locator('label:has-text("VM ID")')).toBeVisible()

    // Node-Dropdown SOLL sichtbar sein (Plus-Modus: 2 Nodes)
    await expect(page.locator('label:has-text("Proxmox Node")')).toBeVisible()
  })

})
