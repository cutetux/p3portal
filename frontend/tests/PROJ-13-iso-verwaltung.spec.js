// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator1","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-signature'

// {"sub":"viewer1","auth_type":"local","role":"viewer","exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIxIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoidmlld2VyIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_TEMPLATES = [
  {
    id: 'debian-13.3',
    name: 'Debian 13 (Trixie) Template',
    description: 'Erstellt ein Debian Trixie Server VM-Template auf Proxmox',
    required_role: 'operator',
  },
]

const MOCK_TEMPLATE_WITH_ISO = {
  id: 'debian-13.3',
  name: 'Debian 13 (Trixie) Template',
  description: 'Erstellt ein Debian Trixie Server VM-Template auf Proxmox',
  required_role: 'operator',
  parameters: [
    { id: 'vm_id', label: 'VM ID', type: 'integer', required: true, min: 100, max: 999999999, default: null },
    { id: 'node', label: 'Proxmox Node', type: 'string', required: true, default: null },
    { id: 'iso_file', label: 'ISO-Datei', type: 'string', required: true, default: null },
  ],
}

const MOCK_NODES = [
  { name: 'pve', status: 'online' },
  { name: 'pve2', status: 'offline' },
]

const MOCK_ISOS = [
  { filename: 'debian-13.4.0-amd64-netinst.iso', volid: 'local:iso/debian-13.4.0-amd64-netinst.iso', size: 650000000 },
  { filename: 'ubuntu-24.04-live-server-amd64.iso', volid: 'local:iso/ubuntu-24.04-live-server-amd64.iso', size: 1200000000 },
]

const MOCK_ISOS_NODE2 = [
  { filename: 'alpine-3.19.iso', volid: 'local:iso/alpine-3.19.iso', size: 200000000 },
]

const MOCK_ISO_QUERY = {
  filename: 'debian-13.4.0-amd64-netinst.iso',
  size: 650000000,
  content_type: 'application/x-iso9660-image',
}

const MOCK_DOWNLOAD_JOB = {
  id: 'job-iso-abc',
  type: 'iso_download',
  playbook: 'debian-13.4.0-amd64-netinst.iso',
  status: 'pending',
  created_at: '2026-04-27T00:00:00Z',
  started_at: null,
  finished_at: null,
  username: 'operator1',
  params: { node: 'pve', url: 'https://example.com/debian.iso', filename: 'debian-13.4.0-amd64-netinst.iso' },
}

// ── Hilfs-Locatoren ───────────────────────────────────────────────────────────
// NodeDropdown: label direkt im Container-Div → label.locator('..').locator('select') funktioniert
// IsoSelect:   label ist in einem flex-Wrapper → uniquer Selektor über die __download__-Option

const nodeSelectLocator = (page) =>
  page.locator('label:has-text("Proxmox Node")').locator('..').locator('select')

// ISO-Select hat immer die Option __download__ → zuverlässiger Selektor
const isoSelectLocator = (page) =>
  page.locator('select:has(option[value="__download__"])')

// ── Setup-Helper ──────────────────────────────────────────────────────────────
// Hinweis: /api/packer/isos?node=... muss per URL-Funktion gematchet werden,
// da Playwright-Glob-Patterns Query-Parameter nicht zuverlässig matchen.

async function setupPage(page, token, {
  nodesMock = MOCK_NODES,
  nodesStatus = 200,
  isosMock = MOCK_ISOS,
  isosStatus = 200,
} = {}) {
  await page.route('/api/packer', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) })
  )
  await page.route('/api/packer/debian-13.3', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_WITH_ISO) })
  )
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('/api/packer/nodes', route =>
    route.fulfill({
      status: nodesStatus,
      contentType: 'application/json',
      body: nodesStatus === 200
        ? JSON.stringify(nodesMock)
        : JSON.stringify({ detail: 'Proxmox nicht erreichbar' }),
    })
  )
  // ISO-Liste: URL-Funktion statt Glob (Query-Params werden zuverlässig gematchet)
  await page.route(
    url => url.pathname === '/api/packer/isos',
    route => route.fulfill({
      status: isosStatus,
      contentType: 'application/json',
      body: isosStatus === 200
        ? JSON.stringify(isosMock)
        : JSON.stringify({ detail: 'ISO-Abruf fehlgeschlagen' }),
    })
  )

  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), token)
  await page.goto('/packer')
  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('h2:has-text("Debian 13 (Trixie) Template")')).toBeVisible()
}

// ── AC1: Node-Dropdown befüllt via GET /packer/nodes ─────────────────────────

test('AC1: Node-Dropdown ist ein Select-Element, befüllt via GET /packer/nodes', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  const nodeSelect = nodeSelectLocator(page)
  await expect(nodeSelect).toBeVisible()
  await expect(nodeSelect.locator('option[value="pve"]')).toBeAttached()
  await expect(nodeSelect.locator('option[value="pve2"]')).toBeAttached()
})

// ── AC2: Offline-Nodes sind erkennbar ────────────────────────────────────────

test('AC2: Offline-Nodes werden als "(offline)" angezeigt und sind disabled', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  const nodeSelect = nodeSelectLocator(page)
  await expect(nodeSelect).toBeVisible()

  await expect(nodeSelect.locator('option[value="pve"]')).toHaveText('pve')
  await expect(nodeSelect.locator('option[value="pve2"]')).toHaveText('pve2 (offline)')
})

// ── AC3: Beim Laden wird Node-Liste automatisch abgerufen ─────────────────────

test('AC3: Node-Liste wird beim Öffnen des Formulars automatisch geladen', async ({ page }) => {
  let nodesCalled = false

  await page.route('/api/packer', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) })
  )
  await page.route('/api/packer/debian-13.3', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_WITH_ISO) })
  )
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('/api/packer/nodes', route => {
    nodesCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NODES) })
  })
  await page.route(
    url => url.pathname === '/api/packer/isos',
    route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ISOS) })
  )

  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), OPERATOR_TOKEN)
  await page.goto('/packer')
  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('h2:has-text("Debian 13 (Trixie) Template")')).toBeVisible()

  await expect(nodeSelectLocator(page).locator('option[value="pve"]')).toBeAttached()
  expect(nodesCalled).toBe(true)
})

// ── AC4: Bei API-Fehler – Fallback auf Freitext-Eingabe ──────────────────────

test('AC4: Bei API-Fehler wird Fallback-Textfeld mit Warnung angezeigt', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN, { nodesStatus: 502 })

  await expect(page.locator('text=Node-Liste nicht verfügbar')).toBeVisible()
  const nodeInput = page.locator('label:has-text("Proxmox Node")').locator('..').locator('input[type="text"]')
  await expect(nodeInput).toBeVisible()
  await nodeInput.fill('pve-manual')
  await expect(nodeInput).toHaveValue('pve-manual')
})

// ── AC5: ISO-Dropdown befüllt via GET /packer/isos?node={node} ───────────────

test('AC5: ISO-Dropdown wird nach Node-Auswahl mit ISO-Liste befüllt', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')

  const isoSelect = isoSelectLocator(page)
  await expect(isoSelect).toBeVisible()
  await expect(isoSelect.locator('option[value="local:iso/debian-13.4.0-amd64-netinst.iso"]')).toBeAttached()
  await expect(isoSelect.locator('option[value="local:iso/ubuntu-24.04-live-server-amd64.iso"]')).toBeAttached()
})

// ── AC6: Wechsel der Node aktualisiert ISO-Liste ──────────────────────────────

test('AC6: Wechsel der Node lädt ISO-Liste neu', async ({ page }) => {
  let isoCallCount = 0

  await page.route('/api/packer', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) })
  )
  await page.route('/api/packer/debian-13.3', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_WITH_ISO) })
  )
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('/api/packer/nodes', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NODES) })
  )
  await page.route(
    url => url.pathname === '/api/packer/isos',
    route => {
      isoCallCount++
      const url = route.request().url()
      const isNode2 = url.includes('node=pve2')
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(isNode2 ? MOCK_ISOS_NODE2 : MOCK_ISOS),
      })
    }
  )

  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), OPERATOR_TOKEN)
  await page.goto('/packer')
  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('h2:has-text("Debian 13 (Trixie) Template")')).toBeVisible()

  const nodeSelect = nodeSelectLocator(page)

  // Erste Node: pve → debian ISOs
  await nodeSelect.selectOption('pve')
  await expect(isoSelectLocator(page).locator('option[value="local:iso/debian-13.4.0-amd64-netinst.iso"]')).toBeAttached()
  const callsAfterFirst = isoCallCount

  // Node zurücksetzen → ISO-Hint erscheint
  await nodeSelect.selectOption({ index: 0 })
  await expect(page.locator('text=Erst eine Node auswählen')).toBeVisible()

  // Node erneut wählen → neuer API-Call
  await nodeSelect.selectOption('pve')
  await expect(isoSelectLocator(page).locator('option[value="local:iso/debian-13.4.0-amd64-netinst.iso"]')).toBeAttached()

  expect(isoCallCount).toBeGreaterThan(callsAfterFirst)
})

// ── AC7: Anzeige Dateiname, submitted Wert = volid ───────────────────────────

test('AC7: ISO-Dropdown zeigt Dateinamen an, submitted Wert ist der Proxmox-Pfad (volid)', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  const isoSelect = isoSelectLocator(page)
  await expect(isoSelect).toBeVisible()

  await expect(isoSelect.locator('option[value="local:iso/debian-13.4.0-amd64-netinst.iso"]'))
    .toHaveText('debian-13.4.0-amd64-netinst.iso')

  await isoSelect.selectOption('local:iso/debian-13.4.0-amd64-netinst.iso')
  await expect(isoSelect).toHaveValue('local:iso/debian-13.4.0-amd64-netinst.iso')
})

// ── AC8: "ISO herunterladen…" Option öffnet Dialog ───────────────────────────

test('AC8: Option "ISO herunterladen…" öffnet den Download-Dialog', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  const isoSelect = isoSelectLocator(page)
  await expect(isoSelect).toBeVisible()

  await isoSelect.selectOption('__download__')

  await expect(page.locator('h2:has-text("ISO herunterladen")')).toBeVisible()
  await expect(page.locator('text=Node: pve')).toBeVisible()
})

// ── AC9: Leerer ISO-Storage – Hinweis + Link ──────────────────────────────────

test('AC9: Bei leerem ISO-Storage wird Hinweis mit Download-Link angezeigt', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN, { isosMock: [] })

  await nodeSelectLocator(page).selectOption('pve')

  await expect(page.locator('text=Keine ISOs im local-Storage gefunden')).toBeVisible()
  await expect(page.locator('button:has-text("ISO herunterladen")')).toBeVisible()
})

// ── AC10: IsoDownloadModal – alle Felder sichtbar ────────────────────────────

test('AC10: ISO-Download-Dialog zeigt URL, Dateiname, Hash, Checksum, SSL-Checkbox', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  await expect(page.locator('h2:has-text("ISO herunterladen")')).toBeVisible()
  await expect(page.locator('label:has-text("URL")')).toBeVisible()
  await expect(page.locator('label:has-text("Dateiname")')).toBeVisible()
  await expect(page.locator('label:has-text("Hash-Algorithmus")')).toBeVisible()
  await expect(page.locator('label:has-text("Checksum")')).toBeVisible()
  await expect(page.locator('text=SSL-Zertifikat verifizieren')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Query URL' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Download starten' })).toBeVisible()
})

// ── AC11: Hash-Algorithmen vollständig ────────────────────────────────────────

test('AC11: Hash-Algorithmus-Dropdown enthält alle 7 Optionen (None bis SHA-512)', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  const algoSelect = page.locator('label:has-text("Hash-Algorithmus")').locator('..').locator('select')
  await expect(algoSelect.locator('option[value=""]')).toHaveText('None')
  await expect(algoSelect.locator('option[value="md5"]')).toHaveText('MD5')
  await expect(algoSelect.locator('option[value="sha1"]')).toHaveText('SHA-1')
  await expect(algoSelect.locator('option[value="sha224"]')).toHaveText('SHA-224')
  await expect(algoSelect.locator('option[value="sha256"]')).toHaveText('SHA-256')
  await expect(algoSelect.locator('option[value="sha384"]')).toHaveText('SHA-384')
  await expect(algoSelect.locator('option[value="sha512"]')).toHaveText('SHA-512')
})

// ── AC12: Checksum-Feld nur aktiv wenn Algo ≠ None ───────────────────────────

test('AC12: Checksum-Eingabe ist deaktiviert wenn Hash-Algo = None und aktiv sonst', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  const algoSelect = page.locator('label:has-text("Hash-Algorithmus")').locator('..').locator('select')
  await expect(algoSelect).toHaveValue('')

  const checksumInput = page.locator('label:has-text("Checksum")').locator('..').locator('input')
  await expect(checksumInput).toBeDisabled()

  await algoSelect.selectOption('sha256')
  await expect(checksumInput).toBeEnabled()

  await algoSelect.selectOption('')
  await expect(checksumInput).toBeDisabled()
})

// ── AC13: SSL-Verify-Checkbox Standard: an ───────────────────────────────────

test('AC13: SSL-Zertifikat-Checkbox ist standardmäßig aktiviert', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  const sslCheckbox = page.locator('text=SSL-Zertifikat verifizieren').locator('..').locator('input[type="checkbox"]')
  await expect(sslCheckbox).toBeChecked()
})

// ── AC14: Query URL befüllt Felder automatisch ───────────────────────────────

test('AC14: "Query URL" befüllt Dateiname, Größe und Content-Type vor', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await page.route('/api/packer/isos/query-url', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ISO_QUERY) })
  )

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  const urlInput = page.locator('label:has-text("URL")').locator('..').locator('input[type="url"]')
  await urlInput.fill('https://cdimage.debian.org/debian-cd/current/amd64/iso-cd/debian-13.4.0-amd64-netinst.iso')

  await page.getByRole('button', { name: 'Query URL' }).click()

  const filenameInput = page.locator('label:has-text("Dateiname")').locator('..').locator('input[type="text"]')
  await expect(filenameInput).toHaveValue('debian-13.4.0-amd64-netinst.iso')

  await expect(page.locator('text=Größe:')).toBeVisible()
  await expect(page.locator('text=Typ:')).toBeVisible()
})

// ── AC15: Download startet Job und zeigt Job-Link ─────────────────────────────

test('AC15: Download-Button startet Job und zeigt Job-Link im ISO-Select', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await page.route('/api/packer/isos/download', route =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(MOCK_DOWNLOAD_JOB) })
  )

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  const urlInput = page.locator('label:has-text("URL")').locator('..').locator('input[type="url"]')
  await urlInput.fill('https://example.com/debian-13.4.0-amd64-netinst.iso')

  const filenameInput = page.locator('label:has-text("Dateiname")').locator('..').locator('input[type="text"]')
  await filenameInput.fill('debian-13.4.0-amd64-netinst.iso')

  await page.getByRole('button', { name: 'Download starten' }).click()

  await expect(page.locator('h2:has-text("ISO herunterladen")')).not.toBeVisible()
  await expect(page.locator('text=ISO-Download läuft')).toBeVisible()
  await expect(page.locator('text=Job anzeigen →')).toBeVisible()
})

// ── AC16: 409-Konflikt – ISO existiert bereits ───────────────────────────────

test('AC16: 409-Konflikt zeigt Warnung mit "Vorhandenes ISO verwenden"', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await page.route('/api/packer/isos/download', route =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ detail: "ISO 'debian-13.iso' existiert bereits auf Node 'pve'" }),
    })
  )

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')

  const urlInput = page.locator('label:has-text("URL")').locator('..').locator('input[type="url"]')
  await urlInput.fill('https://example.com/debian-13.iso')

  const filenameInput = page.locator('label:has-text("Dateiname")').locator('..').locator('input[type="text"]')
  await filenameInput.fill('debian-13.iso')

  await page.getByRole('button', { name: 'Download starten' }).click()

  await expect(page.locator('text=ISO existiert bereits')).toBeVisible()
  await expect(page.locator('button:has-text("Vorhandenes ISO verwenden")')).toBeVisible()
  await expect(page.locator('h2:has-text("ISO herunterladen")')).toBeVisible()
})

// ── AC17: Modal schließen ─────────────────────────────────────────────────────

test('AC17a: Modal wird per "Abbrechen"-Button geschlossen', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')
  await expect(page.locator('h2:has-text("ISO herunterladen")')).toBeVisible()

  await page.getByRole('button', { name: 'Abbrechen' }).click()
  await expect(page.locator('h2:has-text("ISO herunterladen")')).not.toBeVisible()
})

test('AC17b: Modal wird per Klick auf den Schließen-Button (X) geschlossen', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')
  await isoSelectLocator(page).selectOption('__download__')
  await expect(page.locator('h2:has-text("ISO herunterladen")')).toBeVisible()

  // X-Button im Modal-Header klicken (aria-label="Schließen")
  await page.locator('[aria-label="Schließen"]').click()
  await expect(page.locator('h2:has-text("ISO herunterladen")')).not.toBeVisible()
})

// ── AC18: Viewer ist vom Download-Flow ausgeschlossen (Security) ──────────────

test('AC18: Viewer sieht kein ISO-Download-Formular (kein Operator)', async ({ page }) => {
  await setupPage(page, VIEWER_TOKEN)

  await expect(page.locator('text=Keine Berechtigung')).toBeVisible()
  await expect(page.locator('label:has-text("ISO-Datei")')).not.toBeVisible()
})

// ── AC19: Node-Wechsel setzt ISO-Auswahl zurück ───────────────────────────────

test('AC19: Node-Wechsel setzt ISO-Auswahl zurück und zeigt Hinweis', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')

  const isoSelect = isoSelectLocator(page)
  await isoSelect.selectOption('local:iso/debian-13.4.0-amd64-netinst.iso')
  await expect(isoSelect).toHaveValue('local:iso/debian-13.4.0-amd64-netinst.iso')

  // Node zurücksetzen → ISO-Select verschwindet, Hinweis erscheint
  await nodeSelectLocator(page).selectOption({ index: 0 })
  await expect(page.locator('text=Erst eine Node auswählen')).toBeVisible()
})

// ── AC20: ISO-Select Refresh-Button sichtbar nach Node-Auswahl ───────────────

test('AC20: Refresh-Button im ISO-Select ist nach Node-Auswahl sichtbar', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await nodeSelectLocator(page).selectOption('pve')

  const refreshBtn = page.locator('button[title="ISO-Liste aktualisieren"]')
  await expect(refreshBtn).toBeVisible()
})
