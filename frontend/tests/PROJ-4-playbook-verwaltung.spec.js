// p3portal.org
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ0ZXN0dXNlckBwYW0iLCJwcm94bW94X3VzZXIiOiJ0ZXN0dXNlckBwYW0iLCJleHAiOjk5OTk5OTk5OTl9.' +
  'fake-signature'

const MOCK_PLAYBOOKS = [
  {
    id: 'pb_prox-new-vm',
    name: 'VM Provisionieren',
    description: 'Erstellt eine neue VM auf dem Proxmox-Cluster',
    required_role: 'PVEVMAdmin',
  },
  {
    id: 'pb_update',
    name: 'System Update',
    description: 'Führt Systemupdates durch',
    required_role: null,
  },
]

const MOCK_PLAYBOOK_DETAIL = {
  id: 'pb_prox-new-vm',
  name: 'VM Provisionieren',
  description: 'Erstellt eine neue VM auf dem Proxmox-Cluster',
  required_role: 'PVEVMAdmin',
  parameters: [
    { id: 'vm_name', label: 'VM Name', type: 'string', required: true, default: null },
    { id: 'vm_cores', label: 'CPU Kerne', type: 'integer', required: false, default: 2, min: 1, max: 32 },
    { id: 'vm_os', label: 'OS Template', type: 'dropdown', required: true, default: null, options: [
      { label: 'Ubuntu 22.04', value: 'ubuntu-22.04' },
      { label: 'Debian 12', value: 'debian-12' },
    ]},
    { id: 'use_cloudinit', label: 'Cloud-Init', type: 'bool', required: false, default: false },
  ],
}

async function setupAuthAndMockApis(page) {
  await page.evaluate((token) => sessionStorage.setItem('token', token), FAKE_TOKEN)

  await page.route('/api/playbooks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PLAYBOOKS),
    })
  )

  await page.route('/api/playbooks/pb_prox-new-vm', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_PLAYBOOK_DETAIL),
    })
  )

  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ username: 'testuser@pam', capabilities: {}, groups: [] }),
    })
  )
}

// ── AC1: Playbook-Liste zeigt alle Playbooks mit Name und Beschreibung ─────────

test('AC1: Playbook-Liste zeigt alle Playbooks mit Name und Beschreibung', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  await expect(page.locator('text=VM Provisionieren')).toBeVisible()
  await expect(page.locator('text=Erstellt eine neue VM auf dem Proxmox-Cluster')).toBeVisible()
  await expect(page.locator('text=System Update')).toBeVisible()
  await expect(page.locator('text=Führt Systemupdates durch')).toBeVisible()
})

// ── AC2: Playbook hat Detailansicht mit dynamischem Formular ───────────────────

test('AC2: Klick auf Playbook öffnet Detailansicht mit Formular', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  await page.locator('text=VM Provisionieren').first().click()

  // Form header
  await expect(page.locator('h2:has-text("VM Provisionieren")')).toBeVisible()
  // Submit button
  await expect(page.locator('button:has-text("Job starten")')).toBeVisible()
})

// ── AC3: Formularfelder werden aus meta.yaml generiert ────────────────────────

test('AC3: Alle vier Parametertypen werden korrekt gerendert (string, integer, dropdown, bool)', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  await page.locator('text=VM Provisionieren').first().click()

  // string input
  await expect(page.locator('input[type="text"]').first()).toBeVisible()
  // integer input
  await expect(page.locator('input[type="number"]')).toBeVisible()
  // dropdown select
  await expect(page.locator('select')).toBeVisible()
  // bool checkbox
  await expect(page.locator('input[type="checkbox"]')).toBeVisible()
})

// ── AC4: Pflichtfelder werden validiert ───────────────────────────────────────

test('AC4: Pflichtfelder werden client-seitig validiert – Job startet nicht ohne Pflichtfelder', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  await page.locator('text=VM Provisionieren').first().click()

  // Try to submit without filling required fields
  await page.click('button:has-text("Job starten")')

  // Error message for required field should appear
  await expect(page.locator('text=Pflichtfeld').first()).toBeVisible()
})

// ── AC5: Min/Max-Validierung für integer-Felder ───────────────────────────────

test('AC5: Integer-Feld zeigt Min/Max Hinweis und validiert den Eingabewert', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  await page.locator('text=VM Provisionieren').first().click()

  // Hint text min/max shown
  await expect(page.locator('text=Min: 1')).toBeVisible()
  await expect(page.locator('text=Max: 32')).toBeVisible()

  // Fill vm_name first (required)
  await page.fill('input[type="text"]', 'test-vm')

  // Enter a value below minimum
  await page.fill('input[type="number"]', '0')
  await page.click('button:has-text("Job starten")')

  await expect(page.locator('text=Minimum: 1')).toBeVisible()
})

// ── AC6: Dropdown-Optionen werden korrekt gerendert ──────────────────────────

test('AC6: Dropdown-Optionen werden aus meta.yaml korrekt gerendert', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  await page.locator('text=VM Provisionieren').first().click()

  const options = await page.locator('select option').allTextContents()
  expect(options).toContain('Ubuntu 22.04')
  expect(options).toContain('Debian 12')
})

// ── AC7: Playbooks mit und ohne required_role sind sichtbar ──────────────────

test('AC7: Playbooks mit und ohne required_role erscheinen in der Liste', async ({ page }) => {
  await page.goto('/playbooks')
  await setupAuthAndMockApis(page)
  await page.goto('/playbooks')

  // Playbook with required_role
  await expect(page.locator('text=PVEVMAdmin')).toBeVisible()
  // Playbook without required_role
  await expect(page.locator('text=System Update')).toBeVisible()
})

// ── AC8: Leere Playbook-Liste zeigt hilfreiche Meldung ───────────────────────

test('AC8: Leere Playbook-Liste zeigt hilfreiche Hinweismeldung', async ({ page }) => {
  await page.goto('/playbooks')
  await page.evaluate((token) => sessionStorage.setItem('token', token), FAKE_TOKEN)
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'testuser@pam', capabilities: {}, groups: [] }) })
  )
  await page.goto('/playbooks')

  await expect(page.locator('text=meta.yaml')).toBeVisible()
})

// ── Security: Unauthenticated access redirects to /login ─────────────────────

test('SEC: /playbooks ohne JWT leitet zu /login weiter', async ({ page }) => {
  await page.goto('/playbooks')
  await expect(page).toHaveURL(/\/login/)
})
