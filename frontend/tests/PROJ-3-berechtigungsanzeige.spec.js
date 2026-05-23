// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Fixtures ──────────────────────────────────────────────────────────────
// {"sub":"proxuser","auth_type":"proxmox","role":"operator","exp":9999999999,"jti":"prox-session"}
const PROXMOX_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJwcm94dXNlciIsImF1dGhfdHlwZSI6InByb3htb3giLCJyb2xlIjoib3BlcmF0b3IiLCJleHAiOjk5OTk5OTk5OTksImp0aSI6InByb3gtc2Vzc2lvbiJ9' +
  '.fake-sig'

// {"sub":"localop","auth_type":"local","role":"operator","exp":9999999999,"jti":"local-op-session"}
const LOCAL_OP_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJsb2NhbG9wIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoib3BlcmF0b3IiLCJleHAiOjk5OTk5OTk5OTksImp0aSI6ImxvY2FsLW9wLXNlc3Npb24ifQ' +
  '.fake-sig'

// {"sub":"viewer1","auth_type":"local","role":"viewer","exp":9999999999,"jti":"viewer-session"}
const LOCAL_VIEWER_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ2aWV3ZXIxIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoidmlld2VyIiwiZXhwIjo5OTk5OTk5OTk5LCJqdGkiOiJ2aWV3ZXItc2Vzc2lvbiJ9' +
  '.fake-sig'

// {"sub":"localadmin","auth_type":"local","role":"admin","exp":9999999999,"jti":"admin-session"}
const LOCAL_ADMIN_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJsb2NhbGFkbWluIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoiYWRtaW4iLCJleHAiOjk5OTk5OTk5OTksImp0aSI6ImFkbWluLXNlc3Npb24ifQ' +
  '.fake-sig'

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommon(page) {
  await page.route('/api/cluster/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], vms: [] }) })
  )
  await page.route('/api/jobs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/auth/logout', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  )
  await page.route('/api/me/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/sessions/**', route =>
    route.fulfill({ status: 204 })
  )
}

async function mockProxmoxPerms(page, caps = {}, groups = []) {
  await page.route('/api/me/permissions', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: 'proxuser@pam', capabilities: caps, groups }),
    })
  )
}

async function mockLocalPerms(page, role = 'operator') {
  await page.route('/api/me/permissions', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: role === 'admin' ? 'localadmin' : 'localop', capabilities: { app_role: [role] }, groups: [] }),
    })
  )
}

async function mockRbac(page, bypass = false, assignments = []) {
  await page.route('/api/rbac/me/permissions', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ bypass, assignments }),
    })
  )
}

async function mockPlaybooks(page, playbooks = []) {
  await page.route('/api/playbooks', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(playbooks) })
  )
}

async function mockPackerTemplates(page, templates = []) {
  await page.route('/api/packer', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(templates) })
  )
}

const PROXMOX_CAPS = {
  vms: ['VM.Allocate', 'VM.Audit'],
  storage: ['Datastore.Audit'],
}

const MOCK_PLAYBOOKS = [
  { id: 'pb_new_vm', name: 'VM erstellen', description: 'Erstellt eine VM', required_role: 'PVEVMAdmin', category: 'vm_deployment' },
  { id: 'pb_update', name: 'System Update', description: 'Updates', required_role: null, category: 'vm_lxc_config' },
]

const MOCK_TEMPLATES = [
  { id: 'debian', name: 'Debian 13', description: 'Debian Template', required_role: 'PVEVMAdmin' },
  { id: 'ubuntu', name: 'Ubuntu 24', description: 'Ubuntu Template', required_role: null },
]

const RBAC_ASSIGNMENTS = [
  { resource_type: 'vm', resource_id: 101, permissions: ['start', 'stop'] },
  { resource_type: 'lxc', resource_id: 200, permissions: ['start', 'stop', 'snapshot'] },
]

// ── Sidebar-Navigation ────────────────────────────────────────────────────────

test('SB-1: Sidebar enthält Eintrag "Berechtigungen"', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page)
  await mockRbac(page)
  await mockPlaybooks(page)

  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: 'Berechtigungen' })).toBeVisible()
})

test('SB-2: Klick auf "Berechtigungen" navigiert zu /permissions', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page)
  await mockRbac(page)
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Berechtigungen' }).click()
  await expect(page).toHaveURL(/\/permissions/)
})

// ── Dashboard-Widget ──────────────────────────────────────────────────────────

test('DW-1: Dashboard zeigt PermissionsWidget mit Username und "Details →" Link (Proxmox-Nutzer)', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, PROXMOX_CAPS, ['admins'])
  await mockPlaybooks(page)

  await page.goto('/dashboard')
  await expect(page.locator('text=proxuser@pam')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Details →' })).toBeVisible()
})

test('DW-2: Dashboard-Widget zeigt App-Rolle-Badge für lokalen Nutzer', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'operator')
  await mockRbac(page)
  await mockPlaybooks(page)

  await page.goto('/dashboard')
  await expect(page.locator('.text-xs:has-text("operator")').first()).toBeVisible()
})

test('DW-3: "Details →" Link im Widget navigiert zu /permissions', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page)
  await mockRbac(page)
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Details →' }).click()
  await expect(page).toHaveURL(/\/permissions/)
})

test('DW-4: Widget zeigt Fehlertext wenn /api/me/permissions nicht erreichbar', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await page.route('/api/me/permissions', route => route.fulfill({ status: 503 }))
  await mockPlaybooks(page)

  await page.goto('/dashboard')
  await expect(page.locator('text=konnten nicht geladen werden')).toBeVisible()
})

// ── Seite /permissions – Proxmox-Nutzer ──────────────────────────────────────

test('PX-1: /permissions zeigt Username mit Realm für Proxmox-Nutzer', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, PROXMOX_CAPS, ['admins'])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=proxuser@pam')).toBeVisible()
})

test('PX-2: /permissions zeigt Gruppen als Badges', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, PROXMOX_CAPS, ['admins', 'operators'])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=admins')).toBeVisible()
  await expect(page.locator('text=operators')).toBeVisible()
})

test('PX-3: /permissions zeigt "Keine Gruppen zugewiesen" wenn groups ist leer', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, PROXMOX_CAPS, [])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=Keine Gruppen zugewiesen')).toBeVisible()
})

test('PX-4: /permissions zeigt Capability-Kacheln pro Ressourcentyp', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, PROXMOX_CAPS, [])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=VMs')).toBeVisible()
  await expect(page.locator('text=VM.Allocate')).toBeVisible()
  await expect(page.locator('text=Storage')).toBeVisible()
  await expect(page.locator('text=Datastore.Audit')).toBeVisible()
})

test('PX-5: /permissions zeigt Banner wenn keine Capabilities vorhanden', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, {}, [])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=Eingeschränkte Rechte')).toBeVisible()
})

// ── Seite /permissions – Lokaler Portal-Nutzer ───────────────────────────────

test('LO-1: /permissions zeigt Username, "Portal-Nutzer"-Badge und App-Rolle-Badge', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'operator')
  await mockRbac(page, false, RBAC_ASSIGNMENTS)
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=localop')).toBeVisible()
  await expect(page.locator('text=Portal-Nutzer')).toBeVisible()
  await expect(page.locator('text=operator').first()).toBeVisible()
})

test('LO-2: /permissions zeigt RBAC-Assignments in Tabelle', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'operator')
  await mockRbac(page, false, RBAC_ASSIGNMENTS)
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=VM 101')).toBeVisible()
  await expect(page.locator('text=LXC 200')).toBeVisible()
  await expect(page.locator('text=start, stop').first()).toBeVisible()
})

test('LO-3: /permissions zeigt Hinweis wenn keine Assignments vorhanden', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'operator')
  await mockRbac(page, false, [])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=Keine Ressourcen zugewiesen')).toBeVisible()
})

test('LO-4: /permissions zeigt keinen Assignments-Abschnitt wenn bypass=true (Admin)', async ({ page }) => {
  await setToken(page, LOCAL_ADMIN_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'admin')
  await mockRbac(page, true, [])
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=localadmin')).toBeVisible()
  await expect(page.locator('text=Keine Ressourcen zugewiesen')).not.toBeVisible()
})

// ── Freigegebene Playbooks auf /permissions ───────────────────────────────────

test('FP-1: /permissions zeigt Abschnitt "Freigegebene Playbooks" mit Einträgen', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page)
  await mockRbac(page)
  await mockPlaybooks(page, MOCK_PLAYBOOKS)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/permissions')
  await expect(page.locator('text=Freigegebene Playbooks')).toBeVisible()
  await expect(page.locator('text=VM erstellen')).toBeVisible()
  await expect(page.locator('text=System Update')).toBeVisible()
})

test('FP-2: Klick auf Playbook navigiert zu /playbooks', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page)
  await mockRbac(page)
  await mockPlaybooks(page, MOCK_PLAYBOOKS)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/permissions')
  await page.locator('text=VM erstellen').click()
  await expect(page).toHaveURL(/\/playbooks/)
})

test('FP-3: /permissions zeigt Abschnitt "Freigegebene Packer-Builds"', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page)
  await mockRbac(page)
  await mockPlaybooks(page, MOCK_PLAYBOOKS)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/permissions')
  await expect(page.locator('text=Freigegebene Packer-Builds')).toBeVisible()
  await expect(page.locator('text=Debian 13')).toBeVisible()
})

// ── PlaybooksPage-Filterung ───────────────────────────────────────────────────

test('PB-1: viewer sieht nur Playbooks ohne required_role', async ({ page }) => {
  await setToken(page, LOCAL_VIEWER_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'viewer')
  await mockRbac(page)
  await mockPlaybooks(page, MOCK_PLAYBOOKS)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/playbooks')
  // "vm_deployment" category is active by default; "VM erstellen" has required_role → hidden
  // Switch to vm_lxc_config where "System Update" (no required_role) is
  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await expect(page.locator('text=System Update')).toBeVisible()
})

test('PB-2: viewer sieht keine Playbooks mit required_role', async ({ page }) => {
  await setToken(page, LOCAL_VIEWER_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'viewer')
  await mockRbac(page)
  await mockPlaybooks(page, MOCK_PLAYBOOKS)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/playbooks')
  // Active tab: vm_deployment – only "VM erstellen" is there, which has required_role
  await expect(page.locator('text=VM erstellen')).not.toBeVisible()
})

test('PB-3: operator sieht alle Playbooks inkl. required_role', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'operator')
  await mockRbac(page)
  await mockPlaybooks(page, MOCK_PLAYBOOKS)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/playbooks')
  await expect(page.locator('text=VM erstellen')).toBeVisible()
})

test('PB-4: viewer sieht Hinweis "Deine Rolle" wenn alle Playbooks gefiltert', async ({ page }) => {
  await setToken(page, LOCAL_VIEWER_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'viewer')
  await mockRbac(page)
  // Only playbooks with required_role in the active category
  await mockPlaybooks(page, [
    { id: 'pb1', name: 'VM erstellen', description: 'test', required_role: 'PVEVMAdmin', category: 'vm_deployment' },
  ])
  await mockPackerTemplates(page, [])

  await page.goto('/playbooks')
  await expect(page.locator('text=Deine Rolle')).toBeVisible()
})

// ── PackerPage-Filterung ──────────────────────────────────────────────────────

test('PK-1: viewer sieht nur Packer-Templates ohne required_role', async ({ page }) => {
  await setToken(page, LOCAL_VIEWER_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'viewer')
  await mockRbac(page)
  await mockPlaybooks(page)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/packer')
  await expect(page.locator('text=Ubuntu 24')).toBeVisible()
  await expect(page.locator('text=Debian 13')).not.toBeVisible()
})

test('PK-2: operator sieht alle Packer-Templates', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await mockLocalPerms(page, 'operator')
  await mockRbac(page)
  await mockPlaybooks(page)
  await mockPackerTemplates(page, MOCK_TEMPLATES)

  await page.goto('/packer')
  await expect(page.locator('text=Debian 13')).toBeVisible()
  await expect(page.locator('text=Ubuntu 24')).toBeVisible()
})

// ── Error & Edge Cases ────────────────────────────────────────────────────────

test('EC-1: /permissions zeigt Retry-Button bei API-Fehler', async ({ page }) => {
  await setToken(page, LOCAL_OP_TOKEN)
  await mockCommon(page)
  await page.route('/api/me/permissions', route => route.fulfill({ status: 503 }))
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=Erneut versuchen')).toBeVisible()
})

test('EC-2: /permissions lädt für Proxmox-Nutzer ohne /api/rbac/me/permissions Aufruf', async ({ page }) => {
  await setToken(page, PROXMOX_TOKEN)
  await mockCommon(page)
  await mockProxmoxPerms(page, PROXMOX_CAPS, [])

  let rbacCalled = false
  await page.route('/api/rbac/me/permissions', route => {
    rbacCalled = true
    route.fulfill({ status: 200, body: '{}' })
  })
  await mockPlaybooks(page)
  await mockPackerTemplates(page)

  await page.goto('/permissions')
  await expect(page.locator('text=proxuser@pam')).toBeVisible()
  expect(rbacCalled).toBe(false)
})
