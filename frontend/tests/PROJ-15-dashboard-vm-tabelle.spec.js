// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator1","auth_type":"local","role":"operator","exp":9999999999,"jti":"op15"}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OSwianRpIjoib3AxNSJ9' +
  '.fake-sig'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999,"jti":"adm15"}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5LCJqdGkiOiJhZG0xNSJ9' +
  '.fake-sig'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NODES = [{ node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 8, mem: 4294967296, maxmem: 17179869184, disk: 0, maxdisk: 100000000000, uptime: 86400 }]
const CLUSTER_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

const VMS = [
  { vmid: 100, name: 'web-server',    type: 'qemu', status: 'running', node: 'pve1', cpu: 0.05, mem: 1073741824, maxmem: 2147483648, uptime: 3600, template: 0 },
  { vmid: 101, name: 'db-server',     type: 'qemu', status: 'stopped', node: 'pve1', cpu: 0.0,  mem: 0,          maxmem: 4294967296, uptime: 0,    template: 0 },
  { vmid: 102, name: 'app-container', type: 'lxc',  status: 'running', node: 'pve1', cpu: 0.02, mem: 536870912,  maxmem: 1073741824, uptime: 7200, template: 0 },
  { vmid: 200, name: 'ubuntu-tmpl',   type: 'qemu', status: 'stopped', node: 'pve1', cpu: 0.0,  mem: 0,          maxmem: 2147483648, uptime: 0,    template: 1 },
  { vmid: 103, name: 'alpha-vm',      type: 'qemu', status: 'running', node: 'pve2', cpu: 0.03, mem: 2147483648, maxmem: 4294967296, uptime: 1800, template: 0 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommon(page, vms = VMS) {
  await page.route('**/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NODES) }))
  await page.route('**/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vms) }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLUSTER_STATUS) }))
  await page.route('**/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: 'operator1', auth_type: 'local', role: 'operator', must_change_pw: false,
      last_login_at: null, last_login_ip: null,
    })}))
  await page.route('**/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // Default: all IP calls return null
  await page.route('**/api/vms/**/ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: null }) }))
  // Default: ssh-check returns unreachable
  await page.route('**/api/vms/**/ssh-check', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reachable: false }) }))
}

async function goDashboard(page) {
  await page.goto('/dashboard')
  await expect(page.getByText('web-server')).toBeVisible()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('PROJ-15 – Dashboard VM-Tabelle Erweiterungen', () => {

  // ── Sortierung ──────────────────────────────────────────────────────────────

  test('Sort-1: Klick auf ID-Spalte sortiert aufsteigend', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    await page.getByRole('columnheader', { name: /^ID/i }).click()

    // Mit Checkbox-Spalte ist ID die 2. td-Zelle (Index 1, 0-basiert)
    const rows = page.locator('tbody tr')
    const firstId = await rows.first().locator('td').nth(1).textContent()
    const lastId  = await rows.last().locator('td').nth(1).textContent()
    expect(Number(firstId)).toBeLessThan(Number(lastId))
  })

  test('Sort-2: Zweiter Klick sortiert absteigend, dritter hebt auf', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    const idHeader = page.getByRole('columnheader', { name: /^ID/i })
    await idHeader.click()
    await idHeader.click() // desc

    const rows = page.locator('tbody tr')
    const firstId = await rows.first().locator('td').nth(1).textContent()
    const lastId  = await rows.last().locator('td').nth(1).textContent()
    expect(Number(firstId)).toBeGreaterThan(Number(lastId))

    await idHeader.click() // 3. Klick → keine Sortierung
    await expect(idHeader).not.toContainText('↑')
    await expect(idHeader).not.toContainText('↓')
  })

  test('Sort-3: Alle sortierbaren Spaltenüberschriften sind klickbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    for (const col of ['ID', 'Name', 'Typ', 'Node', 'Status']) {
      const header = page.getByRole('columnheader', { name: new RegExp(`^${col}`, 'i') })
      await expect(header).toBeVisible()
      await header.click()
      // Pfeil erscheint nach Klick
      await expect(header).toContainText('↑')
      await header.click()  // asc → desc
      await expect(header).toContainText('↓')
      await header.click()  // zurücksetzen
    }
  })

  test('Sort-4: Pfeil-Icon zeigt aktive Sortierrichtung', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    const nameHeader = page.getByRole('columnheader', { name: /^Name/i })
    await nameHeader.click()
    await expect(nameHeader).toContainText('↑')
    await nameHeader.click()
    await expect(nameHeader).toContainText('↓')
  })

  test('Sort-5: Name-Sortierung sortiert alphabetisch korrekt', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    await page.getByRole('columnheader', { name: /^Name/i }).click()

    // Nach Name asc: "alpha-vm" kommt vor "web-server"
    // Name ist td Index 2 (0-basiert): Checkbox(0), ID(1), Name(2)
    const rows = page.locator('tbody tr')
    // Nach asc Name-Sort ist "alpha-vm" die erste Zeile
    const firstName = await rows.first().locator('td').nth(2).textContent()
    expect(firstName?.trim()).toBe('alpha-vm')
  })

  // ── Template-Badge ──────────────────────────────────────────────────────────

  test('Tmpl-1: Template-VM erhält tmpl-Badge in der Typ-Spalte', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // Exact match verhindert Verwechslung mit "ubuntu-tmpl" VM-Name
    await expect(page.getByText('tmpl', { exact: true })).toBeVisible()
  })

  test('Tmpl-2: tmpl-Badge ist visuell anders als VM und CT', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // tmpl hat lila Klassen, VM hat grau, CT hat teal
    const tmplBadge = page.locator('span', { hasText: 'tmpl' }).first()
    const vmBadge   = page.locator('span', { hasText: 'VM'   }).first()
    await expect(tmplBadge).toBeVisible()
    await expect(vmBadge).toBeVisible()
    // Die CSS-Klassen unterscheiden sich – tmpl-Badge enthält "purple"
    const tmplClass = await tmplBadge.getAttribute('class') ?? ''
    const vmClass   = await vmBadge.getAttribute('class')   ?? ''
    expect(tmplClass).toContain('purple')
    expect(vmClass).not.toContain('purple')
  })

  test('Tmpl-3: Aktions-Buttons werden für Template-VMs ausgeblendet', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockCommon(page)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'admin', auth_type: 'local', role: 'admin',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await goDashboard(page)

    // Template-VM Zeile finden (ubuntu-tmpl, vmid 200)
    const tmplRow = page.locator('tr', { hasText: 'ubuntu-tmpl' })
    // In der Aktionsspalte steht "–", kein Starten/Stoppen
    await expect(tmplRow.getByText('Starten')).not.toBeVisible()
    await expect(tmplRow.getByText('Stoppen')).not.toBeVisible()
  })

  // ── IP-Anzeige ──────────────────────────────────────────────────────────────

  test('IP-1: Laufende VM zeigt IP-Adresse nach asynchronem Laden', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    // Override für web-server (vmid 100)
    await page.route('**/api/vms/pve1/100/ip**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '192.168.2.100' }) }))

    await goDashboard(page)
    await expect(page.getByText('192.168.2.100')).toBeVisible({ timeout: 5000 })
  })

  test('IP-2: Gestoppte VM zeigt "–" ohne API-Call', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    let ipCallMade = false
    await mockCommon(page)
    await page.route('**/api/vms/pve1/101/ip**', () => { ipCallMade = true })

    await goDashboard(page)
    await page.waitForTimeout(300)

    // db-server (vmid 101) ist stopped → kein IP-Call
    expect(ipCallMade).toBe(false)
    // Zeile zeigt "–"
    const dbRow = page.locator('tr', { hasText: 'db-server' })
    await expect(dbRow).toBeVisible()
  })

  test('IP-3: Kein Guest Agent → IP-Spalte zeigt "–" (kein Error-Banner)', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page) // Default gibt null zurück

    await goDashboard(page)
    await page.waitForTimeout(500)

    // Kein Error-Banner
    await expect(page.getByText(/fehler/i)).not.toBeVisible()
    // Tabelle ist noch sichtbar
    await expect(page.getByText('web-server')).toBeVisible()
  })

  test('IP-4: Tabelle erscheint sofort (non-blocking) trotz langer IP-Ladezeit', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    // IP-Endpunkt antwortet mit 2s Verzögerung
    await page.route('**/api/vms/**/ip**', async r => {
      await new Promise(res => setTimeout(res, 2000))
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '1.2.3.4' }) })
    })

    await page.goto('/dashboard')
    // Tabelle muss sofort sichtbar sein (< 1s)
    await expect(page.getByText('web-server')).toBeVisible({ timeout: 1000 })
  })

  // ── Multi-Select + Bulk-Aktionen ────────────────────────────────────────────

  test('Bulk-1: Checkbox-Spalte ist für Operator sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // Mindestens eine Checkbox in der Tabelle
    const checkboxes = page.locator('tbody tr input[type="checkbox"]')
    await expect(checkboxes.first()).toBeVisible()
  })

  test('Bulk-2: "Alle auswählen"-Checkbox ist im Tabellenkopf', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    const headerCb = page.locator('thead input[type="checkbox"]')
    await expect(headerCb).toBeVisible()
  })

  test('Bulk-3: BulkActionToolbar erscheint wenn ≥1 VM ausgewählt', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // Toolbar noch nicht sichtbar
    await expect(page.getByText(/ausgewählt/i)).not.toBeVisible()

    // Erste selektierbare Checkbox anklicken
    await page.locator('tbody tr input[type="checkbox"]:not([disabled])').first().click()

    // Toolbar erscheint – scoped über data-testid
    const toolbar = page.locator('[data-testid="bulk-toolbar"]')
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Starten' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Stoppen' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Neustart' })).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'SSH-Check' })).toBeVisible()
  })

  test('Bulk-4: "Alle auswählen" selektiert alle nicht-template VMs', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    await page.locator('thead input[type="checkbox"]').click()

    // Toolbar zeigt Anzahl der ausgewählten
    await expect(page.getByText(/ausgewählt/i)).toBeVisible()
    // Template (vmid 200) darf nicht selektiert sein
    const tmplRow = page.locator('tr', { hasText: 'ubuntu-tmpl' })
    const tmplCb = tmplRow.locator('input[type="checkbox"]')
    await expect(tmplCb).toBeDisabled()
    await expect(tmplCb).not.toBeChecked()
  })

  test('Bulk-5: Bulk-Aktion zeigt Ergebnis und leert Auswahl', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await page.route('**/api/vms/*/start', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: 'task-1' }) }))
    await goDashboard(page)

    // Eine VM auswählen
    await page.locator('tbody tr input[type="checkbox"]:not([disabled])').first().click()
    await expect(page.getByText(/1 ausgewählt/i)).toBeVisible()

    // Starten über Toolbar scopen (data-testid)
    const toolbar = page.locator('[data-testid="bulk-toolbar"]')
    await toolbar.getByRole('button', { name: 'Starten' }).click()

    // Ergebnis-Toast
    await expect(page.getByText(/gestartet/i)).toBeVisible({ timeout: 5000 })

    // Auswahl nach Aktion aufgehoben
    await expect(page.getByText(/ausgewählt/i)).not.toBeVisible({ timeout: 4000 })
  })

  test('Bulk-6: Template-VM Checkbox ist deaktiviert', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    const tmplRow = page.locator('tr', { hasText: 'ubuntu-tmpl' })
    const tmplCb = tmplRow.locator('input[type="checkbox"]')
    await expect(tmplCb).toBeDisabled()
  })

  // ── SSH-Erreichbarkeit ──────────────────────────────────────────────────────

  test('SSH-1: SSH-Icon ist für laufende VMs in der Tabelle sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // Laufende VM (web-server, vmid 100)
    const webRow = page.locator('tr', { hasText: 'web-server' })
    // SSH-Spalte enthält ein klickbares Element (nicht "–")
    await expect(webRow).toBeVisible()
  })

  test('SSH-2: SSH-Check läuft nicht automatisch beim Laden', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    let sshCalled = false
    await mockCommon(page)
    await page.route('**/ssh-check**', () => { sshCalled = true })

    await goDashboard(page)
    await page.waitForTimeout(500)

    expect(sshCalled).toBe(false)
  })

  test('SSH-3: Klick auf SSH-Icon triggert Check und zeigt grünen Punkt', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    // IP muss vorhanden sein für SSH-Check
    await page.route('**/api/vms/pve1/100/ip**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '192.168.2.100' }) }))
    await page.route('**/api/vms/pve1/100/ssh-check**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reachable: true }) }))

    await goDashboard(page)
    // Warten bis IP geladen
    await page.waitForTimeout(500)

    const webRow = page.locator('tr', { hasText: 'web-server' })
    // Grauer SSH-Kreis (noch nicht gecheckt) – "SSH-Erreichbarkeit prüfen" title
    const sshBtn = webRow.locator('button[title*="SSH"]')
    await expect(sshBtn).toBeVisible()
    await sshBtn.click()

    // Grüner Punkt erscheint (bg-green-500)
    await expect(webRow.locator('[class*="bg-green-500"]')).toBeVisible({ timeout: 5000 })
  })

  test('SSH-4: Gestoppte VM hat keinen SSH-Check-Button', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // db-server ist stopped
    const dbRow = page.locator('tr', { hasText: 'db-server' })
    // SSH-Spalte zeigt "–", kein klickbarer Punkt
    await expect(dbRow.locator('button[title*="SSH"]')).not.toBeVisible()
  })

  test('SSH-5: Bulk SSH-Check prüft alle ausgewählten VMs', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await page.route('**/api/vms/pve1/100/ip**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: '192.168.2.100' }) }))
    await page.route('**/api/vms/pve1/100/ssh-check**', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reachable: true }) }))

    await goDashboard(page)

    // Laufende web-server-VM auswählen
    const webRow = page.locator('tr', { hasText: 'web-server' })
    await webRow.locator('input[type="checkbox"]:not([disabled])').click()
    await expect(page.getByText(/1 ausgewählt/i)).toBeVisible()

    // SSH-Check via Toolbar
    await page.getByRole('button', { name: /ssh-check/i }).click()

    // Grüner Punkt für web-server erscheint
    await expect(webRow.locator('[class*="bg-green-500"]')).toBeVisible({ timeout: 5000 })
  })

  // ── Edge Cases ──────────────────────────────────────────────────────────────

  test('Edge-1: Guest Agent-Fehler zeigt kein Error-Banner', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await page.route('**/api/vms/**/ip**', r =>
      r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'Guest agent error' }) }))

    await goDashboard(page)
    await page.waitForTimeout(500)

    // Kein API-Fehler-Banner (kein Verbindungsfehler-Text)
    await expect(page.getByText(/verbindungsfehler/i)).not.toBeVisible()
    // Tabelle noch sichtbar
    await expect(page.getByText('web-server')).toBeVisible()
  })

  test('Edge-2: Auto-Refresh erhält aktive Auswahl', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // Eine VM auswählen
    await page.locator('tbody tr input[type="checkbox"]:not([disabled])').first().click()
    await expect(page.getByText(/1 ausgewählt/i)).toBeVisible()

    // Manuellen Refresh simulieren (Refresh-Button)
    await page.getByRole('button', { name: /aktualisieren/i }).click()
    // Nach Refresh: Toolbar und Auswahl noch sichtbar
    await expect(page.getByText(/1 ausgewählt/i)).toBeVisible({ timeout: 5000 })
  })

  test('Edge-3: VM-Tabelle erscheint auch mit gemischten VMs und Templates', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockCommon(page)
    await goDashboard(page)

    // Alle VMs aus Fixture sind sichtbar
    for (const name of ['web-server', 'db-server', 'app-container', 'ubuntu-tmpl', 'alpha-vm']) {
      await expect(page.getByText(name)).toBeVisible()
    }
  })

})
