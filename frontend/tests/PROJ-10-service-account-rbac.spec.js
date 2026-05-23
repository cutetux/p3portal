// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Fixtures ─────────────────────────────────────────────────────────────
// Gültige Base64-Payloads (keine echte Signatur – useAuth parst nur Payload)

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"localview","auth_type":"local","role":"viewer","exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJsb2NhbHZpZXciLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// {"sub":"localop","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJsb2NhbG9wIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoib3BlcmF0b3IiLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// {"sub":"localadmin","auth_type":"local","role":"admin","exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJsb2NhbGFkbWluIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// {"sub":"proxmox-user@pam","auth_type":"proxmox","role":"operator","exp":9999999999}
const PROXMOX_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwcm94bW94LXVzZXJAcGFtIiwiYXV0aF90eXBlIjoicHJveG1veCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OX0' +
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

const FAKE_VMS = [
  {
    vmid: 100, name: 'ubuntu-server', type: 'qemu',
    status: 'running', node: 'pve1',
    cpu: 0.05, maxcpu: 2,
    mem: 1073741824, maxmem: 2147483648,
    uptime: 3600,
  },
  {
    vmid: 101, name: 'db-server', type: 'qemu',
    status: 'stopped', node: 'pve1',
    cpu: 0.0, maxcpu: 4,
    mem: 0, maxmem: 4294967296,
    uptime: 0,
  },
]

const FAKE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

const FAKE_SNAPSHOTS = [
  { name: 'snap-before-update', snaptime: 1713897600, description: 'Before update' },
  { name: 'snap-2024-01', snaptime: 1706745600, description: '' },
]

const FAKE_UPID = 'UPID:pve1:00001234:00000001:deadbeef:qmstart:100:root@pam:'

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockClusterApi(page) {
  await page.route('**/api/cluster/nodes', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) })
  )
  await page.route('**/api/cluster/vms', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VMS) })
  )
  await page.route('**/api/cluster/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) })
  )
}

async function mockCluster503(page) {
  await page.route('**/api/cluster/nodes', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"no session"}' })
  )
  await page.route('**/api/cluster/vms', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"no session"}' })
  )
  await page.route('**/api/cluster/status', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"no session"}' })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Cluster-Dashboard – Viewer-Zugang (Service-Account)
// ════════════════════════════════════════════════════════════════════════════

test('DASH-1: Lokaler Viewer sieht Dashboard wenn Viewer-Token konfiguriert ist', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  // Dashboard-Inhalt wird angezeigt (kein Redirect, kein 503-Banner)
  await expect(page.locator('h1:has-text("Cluster-Dashboard")')).toBeVisible()
  await expect(page.locator('text=pve1').first()).toBeVisible()
  await expect(page.locator('text=ubuntu-server')).toBeVisible()
  // Kein TokenMissingBanner
  await expect(page.locator('text=Proxmox-Zugang nicht konfiguriert')).not.toBeVisible()
})

test('DASH-2: Lokaler Viewer sieht amber TokenMissingBanner wenn Viewer-Token fehlt (503)', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await mockCluster503(page)
  await page.goto('/dashboard')

  // Amber-Banner sichtbar
  await expect(page.locator('text=Proxmox-Zugang nicht konfiguriert')).toBeVisible()
  // Zeigt die Viewer-Rolle
  await expect(page.locator('text=Viewer')).toBeVisible()
  // Kein roter Fehler-Banner (der wäre für Proxmox-Nutzer ohne Session)
  await expect(page.locator('text=Proxmox-Tab anmelden')).not.toBeVisible()
})

test('DASH-3: Proxmox-Nutzer sieht roten Fehler-Banner bei 503 (kein amber Banner)', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCluster503(page)
  await page.goto('/dashboard')

  // Kein amber Banner
  await expect(page.locator('text=Proxmox-Zugang nicht konfiguriert')).not.toBeVisible()
  // Roter Fehler-Banner mit Proxmox-Tab-Hinweis
  await expect(page.locator('text=Proxmox-Tab anmelden')).toBeVisible()
})

test('DASH-4: TokenMissingBanner zeigt korrekte Rolle (Admin)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCluster503(page)
  await page.goto('/dashboard')

  await expect(page.locator('text=Proxmox-Zugang nicht konfiguriert')).toBeVisible()
  // "Admin-Rolle" ist spezifisch für den Banner (Sidebar zeigt "Administration")
  await expect(page.locator('text=Admin-Rolle')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 2. RBAC – Aktionen-Spalte sichtbarkeit
// ════════════════════════════════════════════════════════════════════════════

test('RBAC-1: Viewer sieht keine Aktionen-Spalte in der VM-Tabelle', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  await expect(page.locator('text=ubuntu-server')).toBeVisible()
  // Keine Aktionen-Spalte
  await expect(page.locator('th:has-text("Aktionen")')).not.toBeVisible()
  // Keine Start/Stop-Buttons
  await expect(page.locator('button:has-text("Starten")')).not.toBeVisible()
})

test('RBAC-2: Operator sieht Aktionen-Spalte mit Start/Stop/Reboot/Snapshots, aber kein Löschen', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  await expect(page.locator('text=ubuntu-server')).toBeVisible()
  // Aktionen-Spalte vorhanden
  await expect(page.locator('th:has-text("Aktionen")')).toBeVisible()
  // Power-Buttons vorhanden (mehrere, da pro VM)
  await expect(page.locator('button:has-text("Starten")').first()).toBeVisible()
  await expect(page.locator('button:has-text("Stoppen")').first()).toBeVisible()
  await expect(page.locator('button:has-text("Neustarten")').first()).toBeVisible()
  await expect(page.locator('button:has-text("Snapshots")').first()).toBeVisible()
  // Kein Löschen-Button
  await expect(page.locator('button:has-text("Löschen")')).not.toBeVisible()
})

test('RBAC-3: Admin sieht Aktionen-Spalte inkl. Löschen-Button', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  await expect(page.locator('text=ubuntu-server')).toBeVisible()
  await expect(page.locator('th:has-text("Aktionen")')).toBeVisible()
  await expect(page.locator('button:has-text("Löschen")').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 3. VM Power-Aktionen (Operator)
// ════════════════════════════════════════════════════════════════════════════

test('VM-1: Starten-Button schickt POST /api/vms/{vmid}/start und zeigt Erfolgs-Banner', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)

  let startCalled = false
  await page.route('**/api/vms/101/start', route => {
    startCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  await expect(page.locator('text=db-server')).toBeVisible()

  // Starten-Button der gestoppten VM (101) klicken – kein Confirm nötig
  // filter({ hasText: /^Starten$/ }) weil :has-text() case-insensitiv auch "Neustarten" trifft
  const row = page.locator('tr', { has: page.locator('text=db-server') })
  await row.locator('button').filter({ hasText: /^Starten$/ }).click()

  // Kein Confirm-Dialog – direktes Auslösen
  await page.waitForTimeout(300)
  expect(startCalled).toBe(true)
  // Grüner Erfolgs-Banner
  await expect(page.locator('text=Starten wurde gestartet')).toBeVisible()
})

test('VM-2: Stoppen-Button zeigt Inline-Confirm-Dialog und sendet dann POST /api/vms/{vmid}/stop', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)

  let stopCalled = false
  await page.route('**/api/vms/100/stop', route => {
    stopCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Stoppen")').click()

  // Confirm-Dialog erscheint
  await expect(page.locator('text=wirklich').first()).toBeVisible()
  await expect(page.locator('button:has-text("Ja")').first()).toBeVisible()
  await expect(page.locator('button:has-text("Nein")').first()).toBeVisible()
  expect(stopCalled).toBe(false)

  // Bestätigen
  await page.locator('button:has-text("Ja")').first().click()
  await page.waitForTimeout(300)
  expect(stopCalled).toBe(true)
  await expect(page.locator('text=Stoppen wurde gestartet')).toBeVisible()
})

test('VM-3: Stoppen-Confirm – Nein schließt Dialog ohne API-Aufruf', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)

  let stopCalled = false
  await page.route('**/api/vms/100/stop', route => {
    stopCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Stoppen")').click()
  await expect(page.locator('button:has-text("Nein")').first()).toBeVisible()

  await page.locator('button:has-text("Nein")').first().click()
  await page.waitForTimeout(200)
  expect(stopCalled).toBe(false)
  await expect(page.locator('button:has-text("Nein")')).not.toBeVisible()
})

test('VM-4: Neustarten-Button zeigt Inline-Confirm und sendet POST /api/vms/{vmid}/reboot', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)

  let rebootCalled = false
  await page.route('**/api/vms/100/reboot', route => {
    rebootCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Neustarten")').click()

  await expect(page.locator('button:has-text("Ja")').first()).toBeVisible()
  await page.locator('button:has-text("Ja")').first().click()
  await page.waitForTimeout(300)
  expect(rebootCalled).toBe(true)
})

test('VM-5: Starten-Button ist disabled wenn VM running; Stoppen/Neustarten disabled wenn stopped', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  // ubuntu-server ist running (vmid 100)
  const runningRow = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await expect(runningRow.locator('button').filter({ hasText: /^Starten$/ })).toBeDisabled()
  await expect(runningRow.locator('button').filter({ hasText: /^Stoppen$/ })).not.toBeDisabled()

  // db-server ist stopped (vmid 101)
  const stoppedRow = page.locator('tr', { has: page.locator('text=db-server') })
  await expect(stoppedRow.locator('button').filter({ hasText: /^Starten$/ })).not.toBeDisabled()
  await expect(stoppedRow.locator('button').filter({ hasText: /^Stoppen$/ })).toBeDisabled()
  await expect(stoppedRow.locator('button').filter({ hasText: /^Neustarten$/ })).toBeDisabled()
})

test('VM-6: VM-Power-Aktion 403 zeigt "Keine Berechtigung"-Fehler im Banner', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/101/start', route =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Permission denied"}' })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=db-server') })
  await row.locator('button').filter({ hasText: /^Starten$/ }).click()
  await page.waitForTimeout(300)

  await expect(page.locator('text=Keine Berechtigung')).toBeVisible()
})

test('VM-7: VM-Power-Aktion 503 zeigt "Service-Account nicht konfiguriert"-Fehler', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/101/start', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"not configured"}' })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=db-server') })
  await row.locator('button').filter({ hasText: /^Starten$/ }).click()
  await page.waitForTimeout(300)

  await expect(page.locator('text=Service-Account nicht konfiguriert')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Snapshot-Verwaltung
// ════════════════════════════════════════════════════════════════════════════

test('SNAP-1: Snapshots-Button öffnet Modal mit Snapshot-Liste', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_SNAPSHOTS) })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  // Modal öffnet sich
  await expect(page.locator('text=Snapshots – VM 100')).toBeVisible()
  await expect(page.locator('text=snap-before-update')).toBeVisible()
  await expect(page.locator('text=snap-2024-01')).toBeVisible()
})

test('SNAP-2: Snapshot-Modal zeigt Formular zum Erstellen eines neuen Snapshots', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await expect(page.locator('input[placeholder="snapshot-name"]')).toBeVisible()
  await expect(page.locator('button:has-text("Snapshot erstellen")')).toBeVisible()
})

test('SNAP-3: Snapshot erstellen sendet POST mit Name und schließt Form nach Erfolg', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)

  let createBody = null
  await page.route('**/api/vms/100/snapshots', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    createBody = route.request().postDataJSON()
    return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await page.fill('input[placeholder="snapshot-name"]', 'mein-snapshot')
  await page.fill('input[placeholder="Beschreibung (optional)"]', 'Test-Backup')
  await page.click('button:has-text("Snapshot erstellen")')
  await page.waitForTimeout(400)

  expect(createBody).toEqual({ name: 'mein-snapshot', description: 'Test-Backup' })
  // Formular wurde zurückgesetzt
  await expect(page.locator('input[placeholder="snapshot-name"]')).toHaveValue('')
})

test('SNAP-4: Ungültiger Snapshot-Name (Leerzeichen) zeigt Client-seitige Fehlermeldung', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await page.fill('input[placeholder="snapshot-name"]', 'bad name with spaces')
  await page.click('button:has-text("Snapshot erstellen")')

  await expect(page.locator('text=Nur Buchstaben, Zahlen')).toBeVisible()
})

test('SNAP-5: Snapshot-Rollback zeigt Confirm-Dialog und sendet POST /rollback', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_SNAPSHOTS) })
  )

  let rollbackCalled = false
  await page.route('**/api/vms/100/snapshots/snap-before-update/rollback', route => {
    rollbackCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await expect(page.locator('text=snap-before-update')).toBeVisible()
  await page.locator('button:has-text("Rollback")').first().click()

  // Confirm erscheint
  await expect(page.locator('text=Rollback?')).toBeVisible()
  expect(rollbackCalled).toBe(false)

  await page.locator('.fixed button:has-text("Ja")').first().click()
  await page.waitForTimeout(400)
  expect(rollbackCalled).toBe(true)
})

test('SNAP-6: Snapshot löschen zeigt Confirm-Dialog und sendet DELETE', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_SNAPSHOTS) })
  )

  let deleteCalled = false
  await page.route('**/api/vms/100/snapshots/snap-before-update', route => {
    deleteCalled = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await page.locator('button:has-text("Löschen")').first().click()
  await expect(page.locator('text=Löschen?')).toBeVisible()
  expect(deleteCalled).toBe(false)

  await page.locator('.fixed button:has-text("Ja")').first().click()
  await page.waitForTimeout(400)
  expect(deleteCalled).toBe(true)
})

test('SNAP-7: Snapshot-Modal schließt sich beim Klick auf X', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await expect(page.locator('text=Snapshots – VM 100')).toBeVisible()
  await page.click('button[aria-label="Schließen"]')
  await expect(page.locator('text=Snapshots – VM 100')).not.toBeVisible()
})

test('SNAP-8: Leere Snapshot-Liste zeigt Hinweistext', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await expect(page.locator('text=Keine Snapshots vorhanden')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 5. VM-Löschen (Admin)
// ════════════════════════════════════════════════════════════════════════════

test('VM-DELETE-1: Admin kann VM löschen – zweistufiger Confirm + Erfolgs-Banner', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockClusterApi(page)

  let deleteCalled = false
  await page.route('**/api/vms/100', route => {
    if (route.request().method() === 'DELETE') {
      deleteCalled = true
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
    }
  })

  await page.goto('/dashboard')
  await expect(page.locator('text=ubuntu-server')).toBeVisible()

  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Löschen")').click()

  // Confirm-Popover mit Warnung
  await expect(page.locator('text=kann nicht rückgängig')).toBeVisible()
  expect(deleteCalled).toBe(false)

  await page.locator('button:has-text("Ja, löschen")').click()
  await page.waitForTimeout(300)

  expect(deleteCalled).toBe(true)
  await expect(page.locator('text=wird gelöscht')).toBeVisible()
})

test('VM-DELETE-2: Admin-Löschen abbrechen schließt Confirm ohne API-Aufruf', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockClusterApi(page)

  let deleteCalled = false
  await page.route('**/api/vms/100', route => {
    if (route.request().method() === 'DELETE') deleteCalled = true
    route.fulfill({ status: 200 })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Löschen")').click()

  await page.locator('button:has-text("Abbrechen")').click()
  await page.waitForTimeout(200)
  expect(deleteCalled).toBe(false)
  await expect(page.locator('text=Abbrechen')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Feedback-Banner
// ════════════════════════════════════════════════════════════════════════════

test('FEEDBACK-1: Erfolgs-Banner ist mit ✕ schließbar', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/101/start', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ task_id: FAKE_UPID }) })
  )

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=db-server') })
  await row.locator('button').filter({ hasText: /^Starten$/ }).click()
  await page.waitForTimeout(300)

  const banner = page.locator('text=Starten wurde gestartet')
  await expect(banner).toBeVisible()

  // ✕ schließen
  await page.locator('button[aria-label="Schließen"]').first().click()
  await expect(banner).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Sicherheitstests
// ════════════════════════════════════════════════════════════════════════════

test('SEC-1: /dashboard ohne JWT leitet zu /login', async ({ page }) => {
  // Kein Token gesetzt
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/login/)
})

test('SEC-2: Viewer kann keine VM-Operationen auslösen (keine Buttons sichtbar)', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  await expect(page.locator('text=ubuntu-server')).toBeVisible()
  // Kein Start/Stop/Reboot-Button
  await expect(page.locator('button:has-text("Starten")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Stoppen")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Neustarten")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Snapshots")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Löschen")')).not.toBeVisible()
})

test('SEC-3: Operator sieht keinen VM-Löschen-Button', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.goto('/dashboard')

  await expect(page.locator('th:has-text("Aktionen")')).toBeVisible()
  await expect(page.locator('button:has-text("Löschen")')).not.toBeVisible()
})

test('SEC-4: Snapshot-409-Fehler zeigt "bereits existiert"-Meldung statt generischem Fehler', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockClusterApi(page)
  await page.route('**/api/vms/100/snapshots', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: '{"detail":"Snapshot with this name already exists"}',
    })
  })

  await page.goto('/dashboard')
  const row = page.locator('tr', { has: page.locator('text=ubuntu-server') })
  await row.locator('button:has-text("Snapshots")').click()

  await page.fill('input[placeholder="snapshot-name"]', 'exists-snap')
  await page.locator('button').filter({ hasText: /^Snapshot erstellen$/ }).click()

  // Exakter Substring aus der errMsg-Funktion: "...existiert bereits."
  await expect(page.locator('text=existiert bereits')).toBeVisible()
})
