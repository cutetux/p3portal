// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ─────────────────────────────────────────────────────
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

// {"sub":"proxuser@pam","auth_type":"proxmox","role":"operator","exp":9999999999}
const PROXMOX_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwcm94dXNlckBwYW0iLCJhdXRoX3R5cGUiOiJwcm94bW94Iiwicm9sZSI6Im9wZXJhdG9yIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ─────────────────────────────────────────────────────────────

const MOCK_USERS = [
  { id: 1, username: 'admin',    role: 'admin',    active: true,  created_at: '2026-04-27T00:00:00Z' },
  { id: 2, username: 'helpdesk', role: 'operator', active: true,  created_at: '2026-04-27T00:00:00Z' },
]

const MOCK_PRESETS = [
  {
    id: 1,
    name: 'Viewer',
    description: 'Nur lesen',
    permissions: ['view'],
    created_at: '2026-04-27T00:00:00Z',
    created_by: 'system',
    assignment_count: 0,
  },
  {
    id: 2,
    name: 'Operator',
    description: 'Start, Stop, Reboot, Snapshot',
    permissions: ['view', 'start', 'stop', 'reboot', 'snapshot'],
    created_at: '2026-04-27T00:00:00Z',
    created_by: 'system',
    assignment_count: 1,
  },
  {
    id: 3,
    name: 'Admin',
    description: 'Vollzugriff',
    permissions: ['view', 'start', 'stop', 'reboot', 'snapshot', 'configure', 'delete', 'clone'],
    created_at: '2026-04-27T00:00:00Z',
    created_by: 'system',
    assignment_count: 0,
  },
]

const MOCK_ASSIGNMENTS = [
  {
    id: 1,
    user_id: 2,
    resource_type: 'vm',
    resource_id: 100,
    preset_id: 2,
    preset_name: 'Operator',
    permissions: ['view', 'start', 'stop', 'reboot', 'snapshot'],
    created_at: '2026-04-27T00:00:00Z',
    created_by: 'admin',
  },
]

const MOCK_VMS_ALL = [
  {
    vmid: 100, name: 'web-server', type: 'qemu', status: 'running',
    node: 'pve1', cpu: 0.05, maxcpu: 2, mem: 1073741824, maxmem: 2147483648,
    uptime: 3600, permissions: null,
  },
  {
    vmid: 200, name: 'db-server', type: 'qemu', status: 'stopped',
    node: 'pve1', cpu: 0, maxcpu: 4, mem: 0, maxmem: 4294967296,
    uptime: 0, permissions: null,
  },
]

// Filtered for RBAC operator: only VM 100 with view+start permissions
const MOCK_VMS_RBAC_FILTERED = [
  {
    vmid: 100, name: 'web-server', type: 'qemu', status: 'running',
    node: 'pve1', cpu: 0.05, maxcpu: 2, mem: 1073741824, maxmem: 2147483648,
    uptime: 3600, permissions: ['view', 'start'],
  },
]

// Filtered for view-only operator: only VM 100 with view-only
const MOCK_VMS_VIEW_ONLY = [
  {
    vmid: 100, name: 'web-server', type: 'qemu', status: 'running',
    node: 'pve1', cpu: 0.05, maxcpu: 2, mem: 1073741824, maxmem: 2147483648,
    uptime: 3600, permissions: ['view'],
  },
]

const MOCK_NODES = [
  {
    node: 'pve1', status: 'online', cpu: 0.12, maxcpu: 8,
    mem: 4294967296, maxmem: 17179869184, disk: 10737418240,
    maxdisk: 107374182400, uptime: 172800,
  },
]

const FAKE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

// ── Helfer ─────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockPlaybooks(page) {
  await page.route('**/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

async function mockAdminUsers(page, users = MOCK_USERS) {
  await page.route('**/api/admin/users', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(users) })
    } else {
      route.continue()
    }
  })
}

async function mockPresets(page, presets = MOCK_PRESETS) {
  await page.route('**/api/rbac/presets', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(presets) })
    } else {
      route.continue()
    }
  })
}

async function mockAssignments(page, userId = 2, assignments = MOCK_ASSIGNMENTS) {
  await page.route(`**/api/rbac/users/${userId}/assignments`, (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assignments) })
    } else {
      route.continue()
    }
  })
}

async function mockClusterApi(page, vms = MOCK_VMS_ALL) {
  await page.route('**/api/cluster/nodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NODES) })
  )
  await page.route('**/api/cluster/vms', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vms) })
  )
  await page.route('**/api/cluster/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) })
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Rollenpresets-Tab (AC-1)
// ══════════════════════════════════════════════════════════════════════════════

test('RB-1: Admin sieht "Rollenpresets"-Tab auf der Nutzerverwaltungsseite', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.goto('/admin/users')

  await expect(page.locator('button:has-text("Rollenpresets")')).toBeVisible()
})

test('RB-2: Rollenpresets-Tab zeigt Preset-Tabelle mit Standard-Presets', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')

  await expect(page.locator('td:has-text("Viewer")')).toBeVisible()
  await expect(page.locator('td:has-text("Operator")')).toBeVisible()
  await expect(page.locator('td:has-text("Admin")')).toBeVisible()
})

test('RB-3: Admin kann Preset anlegen – "Preset anlegen"-Button und Formular erscheinen', async ({ page }) => {
  let capturedBody = null

  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.route('**/api/rbac/presets', async (route) => {
    if (route.request().method() === 'POST') {
      capturedBody = route.request().postDataJSON()
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 4, name: capturedBody?.name ?? 'New', description: '', permissions: capturedBody?.permissions ?? ['view'], created_at: '2026-04-27T00:00:00Z', created_by: 'admin', assignment_count: 0 }),
      })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PRESETS) })
    }
  })

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')

  await expect(page.locator('button:has-text("Preset anlegen")')).toBeVisible()
  await page.click('button:has-text("Preset anlegen")')

  await expect(page.locator('h2:has-text("Neues Preset")')).toBeVisible()

  await page.fill('input[placeholder="z.B. VM Betreiber"]', 'Test Preset')
  await page.click('button:has-text("Anzeigen")')
  await page.click('button:has-text("Starten")')

  await page.click('button:has-text("Preset anlegen")')

  await expect(async () => {
    expect(capturedBody).not.toBeNull()
  }).toPass()

  expect(capturedBody.name).toBe('Test Preset')
  expect(capturedBody.permissions).toContain('view')
  expect(capturedBody.permissions).toContain('start')
})

test('RB-4: PresetForm verhindert Speichern ohne Aktion – Fehlermeldung erscheint', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')
  await page.click('button:has-text("Preset anlegen")')

  await page.fill('input[placeholder="z.B. VM Betreiber"]', 'Leeres Preset')
  await page.click('button:has-text("Preset anlegen")')

  await expect(page.locator('text=Mindestens eine Aktion muss ausgewählt sein')).toBeVisible()
})

test('RB-5: Admin kann Preset bearbeiten – Edit-Formular erscheint mit vorhandenen Daten', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.route('**/api/rbac/presets/1', async (route) => {
    if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...MOCK_PRESETS[0], permissions: ['view', 'start'] }),
      })
    }
  })

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')

  const viewerRow = page.locator('tr').filter({ hasText: 'Viewer' }).filter({ hasText: 'Nur lesen' })
  await viewerRow.locator('button:has-text("Bearbeiten")').click()

  await expect(page.locator('h2:has-text("Preset bearbeiten")')).toBeVisible()
  await expect(page.locator('input[placeholder="z.B. VM Betreiber"]')).toHaveValue('Viewer')
})

test('RB-6: Lösch-Bestätigungsdialog erscheint beim Klick auf "Löschen"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  // Preset mit 0 Zuweisungen
  await mockPresets(page, [{ ...MOCK_PRESETS[0], assignment_count: 0 }])

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')

  await page.locator('button:has-text("Löschen")').first().click()
  await expect(page.locator('text=wirklich löschen?')).toBeVisible()
})

test('RB-7: Lösch-Warnung erscheint wenn Preset in Benutzung ist (assignment_count > 0)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  // Preset mit 1 Zuweisung
  await mockPresets(page, [{ ...MOCK_PRESETS[1], assignment_count: 1 }])

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')

  await page.locator('button:has-text("Löschen")').first().click()
  await expect(page.locator('text=Warnung: Preset in Benutzung')).toBeVisible()
  await expect(page.locator('strong:has-text("1")')).toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// 2. Ressourcen-Zuweisungen (AC-2)
// ══════════════════════════════════════════════════════════════════════════════

test('RB-8: AssignmentSection erscheint beim Bearbeiten eines Nutzers', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)
  await mockAssignments(page, 2, MOCK_ASSIGNMENTS)

  await page.goto('/admin/users')

  const helpdeskRow = page.locator('tr').filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()

  await expect(page.locator('text=Ressourcen-Zuweisungen')).toBeVisible()
})

test('RB-9: Zuweisungen werden in der AssignmentSection angezeigt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)
  await mockAssignments(page, 2, MOCK_ASSIGNMENTS)

  await page.goto('/admin/users')

  const helpdeskRow = page.locator('tr').filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()

  // Scope to the AssignmentSection (has h3 "Ressourcen-Zuweisungen")
  await expect(page.locator('td:has-text("100")')).toBeVisible()
  // Check preset name in assignment row (scope by resource_id=100 row)
  const row = page.locator('tr').filter({ hasText: '100' }).filter({ hasText: 'Operator' })
  await expect(row).toBeVisible()
})

test('RB-10: Admin kann neue Zuweisung hinzufügen – Formular und Felder korrekt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  // Single route handler for assignments: GET → [], POST → 201 new assignment
  const newAssignment = { id: 99, user_id: 2, resource_type: 'vm', resource_id: 200, preset_id: 1, preset_name: 'Viewer', permissions: ['view'], created_at: '2026-04-27T00:00:00Z', created_by: 'admin' }
  let assignments = []
  await page.route('**/api/rbac/users/2/assignments', async (route) => {
    if (route.request().method() === 'POST') {
      assignments = [newAssignment]
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newAssignment) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(assignments) })
    }
  })

  await page.goto('/admin/users')
  const helpdeskRow = page.locator('tr').filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()

  await expect(page.locator('text=Ressourcen-Zuweisungen')).toBeVisible()
  await page.click('button:has-text("+ Hinzufügen")')

  // Add form must show correct fields
  await expect(page.locator('input[placeholder="VM-ID (z.B. 100)"]')).toBeVisible()
  await expect(page.locator('select[required]')).toBeVisible() // Preset-Dropdown (required)

  await page.fill('input[placeholder="VM-ID (z.B. 100)"]', '200')
  await page.locator('select[required]').selectOption({ index: 1 }) // select first preset

  // No validation error visible before submit
  await expect(page.locator('text=Alle Felder ausfüllen')).not.toBeVisible()

  await page.getByRole('button', { name: 'Speichern', exact: true }).click()

  // After successful POST, the add form closes (setAdding(false) is only called on success)
  await expect(page.locator('input[placeholder="VM-ID (z.B. 100)"]')).not.toBeVisible()
  // Confirm no validation error was shown (preset was selected)
  await expect(page.locator('text=Alle Felder ausfüllen')).not.toBeVisible()
})

test('RB-11: Zuweisung entfernen sendet DELETE-Request', async ({ page }) => {
  let deleteRequested = false

  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.route('**/api/rbac/users/2/assignments', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ASSIGNMENTS) })
    } else {
      route.continue()
    }
  })

  await page.route('**/api/rbac/users/2/assignments/1', async (route) => {
    if (route.request().method() === 'DELETE') {
      deleteRequested = true
      await route.fulfill({ status: 204 })
    }
  })

  await page.goto('/admin/users')
  const helpdeskRow = page.locator('tr').filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()

  await expect(page.locator('td:has-text("100")')).toBeVisible()
  await page.locator('button[title="Zuweisung entfernen"]').click()

  await expect(async () => {
    expect(deleteRequested).toBe(true)
  }).toPass()
})

// ══════════════════════════════════════════════════════════════════════════════
// 3. Dashboard-Filterung (AC-3 + AC-5)
// ══════════════════════════════════════════════════════════════════════════════

test('RB-12: Admin sieht alle VMs ohne RBAC-Filterung (Bypass)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockClusterApi(page, MOCK_VMS_ALL)

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.locator('td:has-text("db-server")')).toBeVisible()
})

test('RB-13: RBAC-Operator sieht nur zugewiesene VMs (server-seitige Filterung)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockClusterApi(page, MOCK_VMS_RBAC_FILTERED)

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.locator('td:has-text("db-server")')).not.toBeVisible()
})

test('RB-14: Proxmox-Login-Nutzer sieht alle VMs (kein RBAC)', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockPlaybooks(page)
  // Proxmox user: no 503, cluster API available via Proxmox session
  await page.route('**/api/cluster/nodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_NODES) })
  )
  await page.route('**/api/cluster/vms', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_VMS_ALL) })
  )
  await page.route('**/api/cluster/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) })
  )

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.locator('td:has-text("db-server")')).toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// 4. Aktions-Button-Filterung (AC-4)
// ══════════════════════════════════════════════════════════════════════════════

test('RB-15: View-only Operator sieht keine Start/Stop/Reboot-Buttons für seine VM', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockClusterApi(page, MOCK_VMS_VIEW_ONLY)

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.locator('button:has-text("Starten")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Stoppen")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Neustarten")')).not.toBeVisible()
})

test('RB-16: Operator mit view+start Preset sieht "Starten" aber nicht "Stoppen"', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockClusterApi(page, MOCK_VMS_RBAC_FILTERED)

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.locator('button:has-text("Starten")')).toBeVisible()
  await expect(page.locator('button:has-text("Stoppen")')).not.toBeVisible()
  await expect(page.locator('button:has-text("Neustarten")')).not.toBeVisible()
})

test('RB-17: Snapshot-Button ausgeblendet wenn "snapshot" nicht im Preset', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockClusterApi(page, MOCK_VMS_RBAC_FILTERED) // view+start only

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.locator('button:has-text("Snapshots")')).not.toBeVisible()
})

test('RB-18: Admin sieht alle Aktionsbuttons ohne RBAC-Einschränkung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  // Admin sees running VM with all permissions (null = full access)
  await mockClusterApi(page, [
    {
      vmid: 100, name: 'web-server', type: 'qemu', status: 'running',
      node: 'pve1', cpu: 0.05, maxcpu: 2, mem: 1073741824, maxmem: 2147483648,
      uptime: 3600, permissions: null,
    },
  ])

  await page.goto('/dashboard')

  await expect(page.locator('td:has-text("web-server")')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Starten', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stoppen', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Neustarten', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Snapshots', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Löschen', exact: true })).toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// 5. Security / Authorization (Red Team)
// ══════════════════════════════════════════════════════════════════════════════

test('RB-19: Operator-Nutzer kann NICHT auf Rollenpresets-Tab zugreifen (/admin/users redirect)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockClusterApi(page, MOCK_VMS_RBAC_FILTERED)

  await page.goto('/admin/users')

  // Operator should be redirected to dashboard
  await expect(page).toHaveURL(/dashboard/)
})

test('RB-20: Leere Nutzerliste zeigt Hinweis "Keine Zuweisungen – Nutzer sieht alle Ressourcen"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)
  await mockAssignments(page, 2, [])

  await page.goto('/admin/users')
  const helpdeskRow = page.locator('tr').filter({ hasText: 'helpdesk' })
  await helpdeskRow.locator('button:has-text("Bearbeiten")').click()

  await expect(page.locator('text=Keine Zuweisungen')).toBeVisible()
  await expect(page.locator('text=bisheriges Verhalten')).toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// 6. Responsive (AC – min. Mobile 375px)
// ══════════════════════════════════════════════════════════════════════════════

test('RB-21: Preset-Tabelle bleibt auf schmalen Viewports nutzbar (768px)', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await setToken(page, ADMIN_TOKEN)
  await mockPlaybooks(page)
  await mockAdminUsers(page)
  await mockPresets(page)

  await page.goto('/admin/users')
  await page.click('button:has-text("Rollenpresets")')

  await expect(page.locator('td:has-text("Viewer")')).toBeVisible()
  await expect(page.locator('button:has-text("Preset anlegen")')).toBeVisible()
})
