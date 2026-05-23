// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

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
  {
    id: 'admin-only',
    name: 'Admin Only Template',
    description: 'Nur für Admins verfügbar',
    required_role: 'admin',
  },
]

const MOCK_TEMPLATE_DETAIL = {
  id: 'debian-13.3',
  name: 'Debian 13 (Trixie) Template',
  description: 'Erstellt ein Debian Trixie Server VM-Template auf Proxmox',
  required_role: 'operator',
  parameters: [
    { id: 'vm_id', label: 'VM ID', type: 'integer', required: true, min: 100, max: 999999999, default: null },
    { id: 'node', label: 'Proxmox Node', type: 'string', required: true, default: null },
  ],
}

const MOCK_ADMIN_ONLY_DETAIL = {
  id: 'admin-only',
  name: 'Admin Only Template',
  description: 'Nur für Admins verfügbar',
  required_role: 'admin',
  parameters: [
    { id: 'vm_id', label: 'VM ID', type: 'integer', required: true, min: 100, default: null },
  ],
}

const MOCK_JOB = {
  id: 'job-abc-123',
  type: 'packer',
  playbook: 'debian-13.3',
  status: 'pending',
  created_at: '2026-04-27T00:00:00Z',
  started_at: null,
  finished_at: null,
  username: 'operator1',
  params: { vm_id: 200, node: 'pve' },
}

// ── Setup-Helper ──────────────────────────────────────────────────────────────

async function setupPage(page, token, { runningTemplateId = null } = {}) {
  const runningJobs = runningTemplateId
    ? [{ id: 'running-job-1', type: 'packer', playbook: runningTemplateId, status: 'running', created_at: '2026-04-27T00:00:00Z', username: 'someone', params: {} }]
    : []

  await page.route('/api/packer', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) })
  )
  await page.route('/api/packer/debian-13.3', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_DETAIL) })
  )
  await page.route('/api/packer/admin-only', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ADMIN_ONLY_DETAIL) })
  )
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runningJobs) })
  )

  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), token)
  await page.goto('/packer')
}

// ── AC1: Sidebar zeigt "Packer"-Menüpunkt ────────────────────────────────────

test('AC1: Packer-Menüpunkt ist in der Sidebar sichtbar (Operator)', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await expect(page.locator('nav a[href="/packer"]')).toBeVisible()
  await expect(page.locator('nav a[href="/packer"]')).toContainText('Packer')
})

test('AC1b: Packer-Menüpunkt ist in der Sidebar sichtbar (Admin)', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  await expect(page.locator('nav a[href="/packer"]')).toBeVisible()
})

test('AC1c: Packer-Menüpunkt ist in der Sidebar sichtbar (Viewer)', async ({ page }) => {
  await setupPage(page, VIEWER_TOKEN)
  await expect(page.locator('nav a[href="/packer"]')).toBeVisible()
})

// ── AC2: Template-Liste mit Name, Beschreibung, required_role ────────────────

test('AC2: Template-Liste zeigt Name, Beschreibung und required_role Badge', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await expect(page.locator('text=Debian 13 (Trixie) Template')).toBeVisible()
  await expect(page.locator('text=Erstellt ein Debian Trixie Server VM-Template auf Proxmox')).toBeVisible()
  await expect(page.locator('text=Admin Only Template')).toBeVisible()
  // required_role badge
  await expect(page.locator('text=operator').first()).toBeVisible()
})

// ── AC3: Viewer sieht Templates aber keine Build-Option ──────────────────────

test('AC3: Viewer sieht Templates (read-only) ohne Build-Möglichkeit', async ({ page }) => {
  await setupPage(page, VIEWER_TOKEN)
  await expect(page.locator('text=Debian 13 (Trixie) Template')).toBeVisible()

  // Klick auf Template → zeigt "Keine Berechtigung"
  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('text=Keine Berechtigung')).toBeVisible()
  await expect(page.locator('button:has-text("Build starten")')).not.toBeVisible()
})

// ── AC4: Operator kann Template auswählen und Formular öffnen ────────────────

test('AC4: Klick auf Template öffnet Build-Formular mit Feldern aus meta.yaml', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await page.locator('text=Debian 13 (Trixie) Template').first().click()

  // Formular-Header
  await expect(page.locator('h2:has-text("Debian 13 (Trixie) Template")')).toBeVisible()
  // Parameter-Felder aus meta.yaml
  await expect(page.locator('label:has-text("VM ID")')).toBeVisible()
  await expect(page.locator('label:has-text("Proxmox Node")')).toBeVisible()
  // Build-Button
  await expect(page.locator('button:has-text("Build starten")')).toBeVisible()
})

// ── AC5: Pflichtfelder werden validiert ──────────────────────────────────────

test('AC5: Pflichtfelder werden client-seitig validiert vor dem Absenden', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('button:has-text("Build starten")')).toBeVisible()

  // Absenden ohne Pflichtfelder
  await page.locator('button:has-text("Build starten")').click()
  await expect(page.locator('text=Pflichtfeld').first()).toBeVisible()
})

// ── AC6: Build starten und Weiterleitung zur Job-Seite ───────────────────────

test('AC6: Erfolgreicher Build-Start leitet zur Job-Detailseite weiter', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await page.route('/api/packer/debian-13.3/build', route =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(MOCK_JOB) })
  )
  // WebSocket-Verbindung für Job-Log abfangen
  await page.route('/api/jobs/job-abc-123', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_JOB) })
  )

  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('label:has-text("VM ID")')).toBeVisible()

  // Felder ausfüllen
  const vmIdInput = page.locator('input[type="number"]').first()
  await vmIdInput.fill('200')
  const nodeInput = page.locator('input[type="text"]').first()
  await nodeInput.fill('pve')

  await page.locator('button:has-text("Build starten")').click()

  // Weiterleitung zur Job-Seite
  await expect(page).toHaveURL(/\/jobs\/job-abc-123/)
})

// ── AC7: Laufender Build deaktiviert den Build-Button ────────────────────────

test('AC7: "Build läuft bereits" Button wenn Build aktiv ist', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN, { runningTemplateId: 'debian-13.3' })

  await page.locator('text=Debian 13 (Trixie) Template').first().click()

  // Button zeigt "Build läuft bereits" und ist deaktiviert
  await expect(page.locator('button:has-text("Build läuft bereits")')).toBeVisible()
  await expect(page.locator('button:has-text("Build läuft bereits")')).toBeDisabled()

  // Pulsierender "läuft"-Badge in der Template-Karte sichtbar
  await expect(page.locator('.animate-pulse').first()).toBeVisible()
})

// ── AC8: Admin sieht "Definition hochladen"-Button ───────────────────────────

test('AC8: Admin sieht "Definition hochladen"-Button', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  await expect(page.locator('button:has-text("Definition hochladen")')).toBeVisible()
})

test('AC8b: Operator sieht keinen "Definition hochladen"-Button', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await expect(page.locator('button:has-text("Definition hochladen")')).not.toBeVisible()
})

// ── AC9: Upload-Modal mit zwei Dateifeldern ───────────────────────────────────

test('AC9: Upload-Modal öffnet sich mit zwei Dateifeldern (.pkr.hcl und meta.yaml)', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  await page.locator('button:has-text("Definition hochladen")').click()

  // Modal sichtbar
  await expect(page.locator('text=Packer-Definition hochladen')).toBeVisible()
  // Zwei Dateifelder
  await expect(page.locator('text=Build-Definition')).toBeVisible()
  await expect(page.locator('text=Metadaten')).toBeVisible()
  // Hinweise auf Dateiformat
  await expect(page.locator('text=.pkr.hcl')).toBeVisible()
  await expect(page.locator('text=meta.yaml')).toBeVisible()
})

// ── AC10: Upload-Fehler bei fehlenden Dateien ────────────────────────────────

test('AC10: Upload-Fehler wenn keine Dateien ausgewählt wurden', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  await page.locator('button:has-text("Definition hochladen")').click()
  await expect(page.locator('text=Packer-Definition hochladen')).toBeVisible()

  // Absenden ohne Dateien
  await page.getByRole('button', { name: 'Hochladen', exact: true }).click()
  await expect(page.locator('text=Beide Dateien sind erforderlich')).toBeVisible()
})

// ── AC11: Name-Kollision beim Upload → Fehlermeldung ─────────────────────────

test('AC11: Upload mit bereits vorhandenem Template-Namen zeigt Fehlermeldung (409)', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)

  await page.route('/api/packer/upload', route =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ detail: "Template 'debian-13.3' existiert bereits" }),
    })
  )

  await page.locator('button:has-text("Definition hochladen")').click()
  await expect(page.locator('text=Packer-Definition hochladen')).toBeVisible()

  // Datei-Inputs befüllen (simuliert durch DataTransfer)
  const hclContent = new TextEncoder().encode('variable "test" {}')
  const metaContent = new TextEncoder().encode('name: Test\ndescription: Test template\n')

  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: 'debian-13.3.pkr.hcl',
    mimeType: 'application/octet-stream',
    buffer: hclContent,
  })
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: 'meta.yaml',
    mimeType: 'application/x-yaml',
    buffer: metaContent,
  })

  await page.getByRole('button', { name: 'Hochladen', exact: true }).click()
  await expect(page.locator('text=Ein Template mit diesem Namen existiert bereits')).toBeVisible()
})

// ── AC12: Admin sieht Löschen-Button pro Template ────────────────────────────

test('AC12: Admin sieht "Löschen"-Button pro Template-Karte', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  // Löschen-Button vorhanden (mind. 1 pro Template)
  await expect(page.locator('button:has-text("Löschen")').first()).toBeVisible()
})

test('AC12b: Operator sieht keinen "Löschen"-Button', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)
  await expect(page.locator('button:has-text("Löschen")')).not.toBeVisible()
})

// ── AC13: Löschen mit Inline-Bestätigung ─────────────────────────────────────

test('AC13: Löschen zeigt Inline-Bestätigungsabfrage bevor gelöscht wird', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)

  // Ersten Löschen-Button klicken
  await page.locator('button:has-text("Löschen")').first().click()

  // Bestätigungs-Dialog erscheint inline
  await expect(page.locator('text=Wirklich löschen?')).toBeVisible()
  await expect(page.locator('button:has-text("Bestätigen")')).toBeVisible()
  await expect(page.locator('button:has-text("Abbrechen")')).toBeVisible()
})

test('AC13b: Abbrechen schließt den Bestätigungs-Dialog', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  await page.locator('button:has-text("Löschen")').first().click()
  await expect(page.locator('text=Wirklich löschen?')).toBeVisible()

  await page.locator('button:has-text("Abbrechen")').click()
  await expect(page.locator('text=Wirklich löschen?')).not.toBeVisible()
})

// ── AC14: Template nach Löschen aus Liste entfernt ───────────────────────────

test('AC14: Template verschwindet nach Löschen aus der Liste', async ({ page }) => {
  // Boolean-Flag statt Counter: React StrictMode ruft useEffect 2x auf
  // und würde einen Counter zu früh hochzählen.
  let templateDeleted = false

  await page.route('/api/packer', route => {
    const list = templateDeleted ? [MOCK_TEMPLATES[1]] : MOCK_TEMPLATES
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  })
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('/api/packer/debian-13.3', async route => {
    if (route.request().method() === 'DELETE') {
      templateDeleted = true
      await route.fulfill({ status: 204 })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_DETAIL) })
    }
  })
  await page.route('/api/packer/admin-only', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ADMIN_ONLY_DETAIL) })
  )

  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/packer')

  await expect(page.locator('text=Debian 13 (Trixie) Template')).toBeVisible()
  await page.locator('button:has-text("Löschen")').first().click()
  await expect(page.locator('text=Wirklich löschen?')).toBeVisible()
  await page.locator('button:has-text("Bestätigen")').click()

  await expect(page.locator('text=Debian 13 (Trixie) Template')).not.toBeVisible()
  await expect(page.locator('text=Admin Only Template')).toBeVisible()
})

// ── AC15: Löschen mit laufendem Build blockiert ───────────────────────────────

test('AC15: Löschen schlägt mit Fehler fehl wenn Build läuft (HTTP 409)', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)

  await page.route('**/api/packer/debian-13.3', async route => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Template kann nicht gelöscht werden, da ein Build läuft' }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_DETAIL) })
    }
  })

  await page.locator('button:has-text("Löschen")').first().click()
  await page.locator('button:has-text("Bestätigen")').click()

  // Fehlermeldung sichtbar
  await expect(page.locator('text=Build läuft – löschen nicht möglich')).toBeVisible()
})

// ── AC16: Credential-Parameter nicht im Formular ────────────────────────────

test('AC16: Credential-Parameter (proxmox_api_url etc.) erscheinen nicht im Formular', async ({ page }) => {
  const detailWithCredentials = {
    ...MOCK_TEMPLATE_DETAIL,
    // Backend filtert diese heraus – sie dürfen im Frontend nicht ankommen
    parameters: MOCK_TEMPLATE_DETAIL.parameters, // bereits gefiltert
  }
  await setupPage(page, OPERATOR_TOKEN)
  await page.route('/api/packer/debian-13.3', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailWithCredentials) })
  )

  await page.locator('text=Debian 13 (Trixie) Template').first().click()
  await expect(page.locator('h2:has-text("Debian 13 (Trixie) Template")')).toBeVisible()

  // Credential-Parameter dürfen nicht als Formularfelder erscheinen
  await expect(page.locator('label:has-text("proxmox_api_url")')).not.toBeVisible()
  await expect(page.locator('label:has-text("proxmox_api_token_id")')).not.toBeVisible()
  await expect(page.locator('label:has-text("proxmox_api_token_secret")')).not.toBeVisible()
})

// ── AC17: Operator kann Template mit required_role "admin" nicht starten ──────

test('AC17: Operator sieht "Keine Berechtigung" für Admin-only Template', async ({ page }) => {
  await setupPage(page, OPERATOR_TOKEN)

  await page.locator('text=Admin Only Template').first().click()
  await expect(page.locator('text=Keine Berechtigung')).toBeVisible()
  await expect(page.locator('button:has-text("Build starten")')).not.toBeVisible()
})

// ── AC18: Leere Template-Liste zeigt Hinweis ─────────────────────────────────

test('AC18: Leere Template-Liste zeigt passenden Hinweis', async ({ page }) => {
  await page.route('/api/packer', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/packer')

  await expect(page.locator('text=Keine Templates verfügbar')).toBeVisible()
  // Admin sieht Hinweis zum Hochladen
  await expect(page.locator('text=.pkr.hcl')).toBeVisible()
})

// ── AC19: Upload schließt Modal und Template erscheint in Liste ───────────────

test('AC19: Erfolgreich hochgeladenes Template erscheint in der Liste', async ({ page }) => {
  const newTemplate = { id: 'ubuntu-24', name: 'Ubuntu 24.04 Template', description: 'Ubuntu LTS', required_role: 'operator' }

  // Boolean-Flag statt Counter (React StrictMode ruft useEffect 2x auf)
  let templateUploaded = false
  await page.route('/api/packer', route => {
    const list = templateUploaded ? [...MOCK_TEMPLATES, newTemplate] : MOCK_TEMPLATES
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) })
  })
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )
  await page.route('/api/packer/debian-13.3', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATE_DETAIL) })
  )
  await page.route('/api/packer/admin-only', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ADMIN_ONLY_DETAIL) })
  )
  await page.route('/api/packer/upload', route => {
    templateUploaded = true
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newTemplate) })
  })

  await page.goto('/packer')
  await page.evaluate(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/packer')

  await expect(page.locator('text=Debian 13 (Trixie) Template')).toBeVisible()

  await page.locator('button:has-text("Definition hochladen")').click()
  await expect(page.locator('text=Packer-Definition hochladen')).toBeVisible()

  await page.locator('input[type="file"]').nth(0).setInputFiles({
    name: 'ubuntu-24.pkr.hcl',
    mimeType: 'application/octet-stream',
    buffer: new TextEncoder().encode('variable "proxmox_api_url" { type = string }'),
  })
  await page.locator('input[type="file"]').nth(1).setInputFiles({
    name: 'meta.yaml',
    mimeType: 'application/x-yaml',
    buffer: new TextEncoder().encode('name: Ubuntu 24.04 Template\ndescription: Ubuntu LTS\nrequired_role: operator\n'),
  })

  await page.getByRole('button', { name: 'Hochladen', exact: true }).click()

  // Modal geschlossen, neues Template in der Liste
  await expect(page.locator('text=Packer-Definition hochladen')).not.toBeVisible()
  await expect(page.locator('text=Ubuntu 24.04 Template')).toBeVisible()
})

// ── AC20: Modal kann abgebrochen werden ──────────────────────────────────────

test('AC20: Upload-Modal kann mit "Abbrechen" geschlossen werden', async ({ page }) => {
  await setupPage(page, ADMIN_TOKEN)
  await page.locator('button:has-text("Definition hochladen")').click()
  await expect(page.locator('text=Packer-Definition hochladen')).toBeVisible()

  await page.locator('button:has-text("Abbrechen")').click()
  await expect(page.locator('text=Packer-Definition hochladen')).not.toBeVisible()
})
