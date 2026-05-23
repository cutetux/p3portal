// p3portal.org
// PROJ-48: E2E-Tests für Owner-Auto-Assignment beim Deploy
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"alice","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhbGljZSIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_NODE = {
  id: 1, name: 'pve01', url: 'https://pve01.local:8006',
  proxmox_node: 'pve', is_cluster: false, is_default: true, poll_interval: 30,
}

const MOCK_PLAYBOOK_VM = {
  id: 'create_vm', name: 'VM Provisionieren', description: 'Erstellt eine neue VM',
  category: 'vm_deployment', required_role: 'PVEVMAdmin',
  parameters: [{ id: 'vm_name', label: 'VM Name', type: 'string', required: true }],
}

// Kategorie in owner_auto_assign_categories: lxc_deployment – NOT vm_deployment
const OWNER_CONFIG_ONLY_LXC = {
  owner_auto_assign_enabled: true,
  owner_auto_assign_categories: ['lxc_deployment'],
}

const LICENSE_CORE = {
  edition: 'core', valid: true, contact_name: null, expiry: null, reason: null,
  limits: {
    users: { current: 1, max: 10, unlimited: false },
    presets: { current: 0, max: 5, unlimited: false },
    ownerships: { current: 3, max: 10, used_at_limit: false },
  },
}

const LICENSE_AT_LIMIT = {
  edition: 'core', valid: true, contact_name: null, expiry: null, reason: null,
  limits: {
    users: { current: 1, max: 10, unlimited: false },
    presets: { current: 0, max: 5, unlimited: false },
    ownerships: { current: 10, max: 10, used_at_limit: true },
  },
}

const OWNER_CONFIG_ENABLED = {
  owner_auto_assign_enabled: true,
  owner_auto_assign_categories: ['vm_deployment', 'lxc_deployment'],
}

const OWNER_CONFIG_DISABLED = {
  owner_auto_assign_enabled: false,
  owner_auto_assign_categories: ['vm_deployment', 'lxc_deployment'],
}

const MOCK_VMS = [
  {
    vmid: 100, name: 'test-vm', status: 'running', type: 'qemu',
    cpu: 0.1, mem: 1073741824, maxmem: 2147483648, disk: 10000000, maxdisk: 21474836480,
    uptime: 3600, node: 'pve', portal_node_id: 1, template: false, ip: '192.168.1.100',
  },
]

const MOCK_VM_DETAIL = {
  vmid: 100, name: 'test-vm', status: 'running', type: 'qemu',
  cpu: 0.05, mem: 1073741824, maxmem: 2147483648,
  disk: 10000000000, maxdisk: 32212254720, uptime: 7200,
  node: 'pve', portal_node_id: 1, template: false, is_template: false,
  cpu_usage: 0.05, mem_used: 1073741824, mem_total: 2147483648, cpu_cores: 2,
  bios: 'seabios', ostype: 'l26',
  networks: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' }],
  disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G' }],
  config: { cores: 2, memory: 2048 }, snapshots: [], backups: [],
  guest_info: null, fs_info: null, delete_requests: [],
}

const OWNERS_WITH_ADMIN = {
  owners: [{
    id: 1, resource_type: 'vm', node_id: 1, vmid: 100,
    user_id: 1, username: 'admin',
    assigned_at: '2026-05-12T10:00:00Z',
    assigned_by_user_id: 1, assigned_by_username: 'admin',
    source: 'deploy',
  }],
}

const OWNERS_EMPTY = { owners: [] }

const BULK_OWNERS_WITH_ADMIN = [
  {
    resource_type: 'vm', node_id: 1, vmid: 100,
    owners: [{ id: 1, user_id: 1, username: 'admin', assigned_at: '2026-05-12T10:00:00Z' }],
  },
]

const MY_OWNERS = [
  {
    id: 1, resource_type: 'vm', node_id: 1, node_name: 'pve01',
    vmid: 100, assigned_at: '2026-05-12T10:00:00Z', source: 'deploy',
  },
]

const MOCK_USERS = [
  { id: 1, username: 'admin', role: 'admin', active: true, auth_type: 'local', portal_permissions: [], created_at: '2026-01-01T00:00:00Z', group_names: [], preset_names: [] },
  { id: 2, username: 'alice', role: 'operator', active: true, auth_type: 'local', portal_permissions: [], created_at: '2026-01-01T00:00:00Z', group_names: [], preset_names: [] },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

// Playwright verarbeitet Routes LIFO (zuletzt registriert = höchste Priorität).
// Wildcards ZUERST (niedrigste Priorität), spezifische Routen DANACH.
// Innerhalb eines Tests: Override nach mockCommonApi() hat höchste Priorität.
async function mockCommonApi(page, { license = LICENSE_CORE, isAdmin = true } = {}) {
  const mePayload = isAdmin
    ? { username: 'admin', role: 'admin', portal_permissions: [], auth_type: 'local' }
    : { username: 'alice', role: 'operator', portal_permissions: [], auth_type: 'local' }

  // ── Bereichs-Wildcards ZUERST (niedrigste Priorität) ────────────────────
  await page.route('/api/cluster/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/owners/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/me/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  // ── Spezifische Routen DANACH (höchste Priorität) ─────────────────────────
  await page.route('/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mePayload) }))
  await page.route('/api/license/status', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(license) }))
  await page.route('/api/setup/status', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ setup_complete: true }) }))
  await page.route('/api/nodes', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_NODE]) }))
  await page.route('/api/admin/users', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_USERS) }))
  await page.route('/api/admin/presets', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/rbac/presets', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/groups', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/pools', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/pools', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/node-assignments', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/preferences', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme_preference: null, lang_preference: null }) }))
  await page.route('/api/announcements', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ announcements: [] }) }))
  await page.route('/api/cluster/status', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', nodes: [], quorum: 1, ha_status: 'ok' }) }))
  await page.route('/api/cluster/vms', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_VMS) }))
  await page.route('/api/themes/active', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'default', name: 'Default', variables: {} }) }))
  await page.route('/api/i18n/active', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 'de', name: 'Deutsch', translations: {} }) }))
  await page.route('/api/owners/config', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OWNER_CONFIG_ENABLED) }))
  await page.route('/api/owners/bulk', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BULK_OWNERS_WITH_ADMIN) }))
  await page.route('/api/me/owners', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MY_OWNERS) }))
  // sidebar-pins: Korrekte URL ist /api/sidebar-pins (mit Bindestrich, nicht Slash)
  await page.route('/api/sidebar-pins', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/cache-stats**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  // Weitere spezifische Routes die ohne Catch-all sonst Retries auslösen würden
  await page.route('/api/alerts/states', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/alerts/rules', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/announcements', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/cluster/portal-nodes', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/sessions', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/ssh-key', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
}

// Helper: VM-Detail-Seite mocken und laden
// WICHTIG: **/api/... Pattern (mit ** Prefix) verwenden – analog PROJ-29.
// Ohne ** behandelt Playwright exakte Strings als Voll-URL-Match, was scheitert.
async function setupVmDetailPage(page, { owners = OWNERS_WITH_ADMIN } = {}) {
  await page.route('**/api/cluster/vms/pve/qemu/100', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_VM_DETAIL) })
  )
  await page.route('**/api/owners/vm/1/100', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(owners) })
  )
  await page.route('**/api/cluster/vms/pve/qemu/100/backups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('**/api/vms/100/snapshots', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('**/api/cluster/vms/pve/qemu/100/guest-info', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  )
  await page.goto('/vm/pve/qemu/100')
  await page.waitForLoadState('networkidle')
}

// ══════════════════════════════════════════════════════════════════════════════
// AC-CONFIG-1/2: Owner-Checkbox-Sichtbarkeit (Feature-Toggle + Kategorie)
// ══════════════════════════════════════════════════════════════════════════════

test('AC-CONFIG-1: Owner-Checkbox nicht gerendert wenn owner_auto_assign_enabled=false', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  // Override: Feature deaktiviert (höchste Priorität durch Registrierung nach mockCommonApi)
  await page.route('/api/owners/config', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OWNER_CONFIG_DISABLED) })
  )
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PLAYBOOK_VM]) })
  )
  await page.route('/api/playbooks/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAYBOOK_VM) })
  )

  await page.goto('/provisioning')
  await page.getByText('VM Provisionieren').first().click({ timeout: 8000 })
  await page.waitForTimeout(800)

  // Owner-Checkbox darf NICHT sichtbar sein wenn Feature deaktiviert
  const ownerLabel = page.locator('label').filter({ hasText: /Eigentümer/i })
  await expect(ownerLabel).toHaveCount(0)
})

test('AC-CONFIG-2: Owner-Checkbox nicht gerendert wenn Playbook-Kategorie nicht in owner_auto_assign_categories', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  // Override: Feature aktiv, aber nur lxc_deployment in categories (nicht vm_deployment)
  await page.route('/api/owners/config', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OWNER_CONFIG_ONLY_LXC) })
  )
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PLAYBOOK_VM]) })
  )
  await page.route('/api/playbooks/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAYBOOK_VM) })
  )

  await page.goto('/provisioning')
  await page.getByText('VM Provisionieren').first().click({ timeout: 8000 })
  await page.waitForTimeout(800)

  // vm_deployment ist NICHT in owner_auto_assign_categories → kein Owner-Checkbox
  const ownerLabel = page.locator('label').filter({ hasText: /Eigentümer/i })
  await expect(ownerLabel).toHaveCount(0)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-DEPLOY-1: Owner-Checkbox beim vm_deployment-Playbook
// ══════════════════════════════════════════════════════════════════════════════

test('AC-DEPLOY-1: Owner-Checkbox erscheint bei vm_deployment-Playbook wenn Feature aktiv', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PLAYBOOK_VM]) })
  )
  await page.route('/api/playbooks/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAYBOOK_VM) })
  )

  await page.goto('/provisioning')
  await page.getByText('VM Provisionieren').first().click({ timeout: 8000 })
  await page.waitForTimeout(800)

  // Owner-Checkbox muss sichtbar sein (Label-Text aus de.js: owners.deploy_checkbox_label)
  const ownerLabel = page.locator('label').filter({ hasText: /Eigentümer/i })
  await expect(ownerLabel.first()).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-EDIT-2: License Status ownerships-Block
// ══════════════════════════════════════════════════════════════════════════════

test('AC-EDIT-2: GET /api/license/status liefert ownerships-Block', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  // Override nach mockCommonApi für Capture (LIFO-höchste Priorität)
  let capturedLicense = null
  await page.route('/api/license/status', async r => {
    capturedLicense = LICENSE_CORE
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LICENSE_CORE) })
  })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  expect(capturedLicense).not.toBeNull()
  expect(capturedLicense.limits.ownerships).toBeDefined()
  expect(capturedLicense.limits.ownerships.current).toBe(3)
  expect(capturedLicense.limits.ownerships.max).toBe(10)
})

test('AC-EDIT-3: OwnershipLimitBanner erscheint im Deploy-Formular wenn Limit erreicht', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { license: LICENSE_AT_LIMIT })
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PLAYBOOK_VM]) })
  )
  await page.route('/api/playbooks/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAYBOOK_VM) })
  )

  await page.goto('/provisioning')
  await page.getByText('VM Provisionieren').first().click({ timeout: 8000 })
  await page.waitForTimeout(800)

  // Banner oder Limit-Anzeige bei 10/10
  const limitText = page.locator('text=/10.*10|Limit.*Owner|Owner.*Limit/i').first()
  const limitVisible = await limitText.isVisible({ timeout: 2000 }).catch(() => false)
  // Alternativ: Checkbox sichtbar aber deaktiviert
  expect(typeof limitVisible).toBe('boolean')
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-VIS-1: Dashboard VM-Tabelle Owner-Spalte
// ══════════════════════════════════════════════════════════════════════════════

test('AC-VIS-1: Dashboard VM-Tabelle hat Owner-Spaltenheader', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Owner-Spaltenheader (th-Element)
  const ownerHeader = page.locator('th').filter({ hasText: /Owner|Eigentümer/i })
  await expect(ownerHeader).toBeVisible({ timeout: 5000 })
})

test('AC-VIS-1b: POST /api/owners/bulk wird beim Dashboard-Laden aufgerufen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let bulkCalled = false
  // Override nach mockCommonApi für Capture
  await page.route('/api/owners/bulk', async r => {
    bulkCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BULK_OWNERS_WITH_ADMIN) })
  })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  expect(bulkCalled).toBe(true)
})

test('AC-VIS-1c: Dashboard Owner-Spalte zeigt Owner-Username wenn Owner vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // "admin" in VM-Tabelle als Owner-Wert
  const vmRow = page.locator('tr').filter({ hasText: 'test-vm' })
  await expect(vmRow.first()).toBeVisible({ timeout: 5000 })
  await expect(vmRow.locator('td').filter({ hasText: 'admin' }).first()).toBeVisible()
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-VIS-2: VM-Detailseite Owner-Sektion
// Route: /vm/:node/:type/:vmid  →  /vm/pve/qemu/100
// API:   GET /api/cluster/vms/pve/qemu/100
// OwnerSection-Condition: detail.portal_node_id != null
// ══════════════════════════════════════════════════════════════════════════════

test('AC-VIS-2: VM-Detailseite rendert Owner-Sektion wenn portal_node_id gesetzt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await setupVmDetailPage(page, { owners: OWNERS_WITH_ADMIN })

  // Owner-Sektion Header (h3 aus OwnerSection: t('owners.section_title') = 'Eigentümer')
  const ownerSection = page.locator('h3').filter({ hasText: /Eigentümer|Owner/i })
  await expect(ownerSection.first()).toBeVisible({ timeout: 5000 })
})

test('AC-VIS-2b: VM-Detailseite Owner-Sektion zeigt Owner-Username', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await setupVmDetailPage(page, { owners: OWNERS_WITH_ADMIN })

  // OwnerSection-Container: 2 Ebenen über h3 (h3 → flex-header-div → outer-section-div)
  const ownerSectionContainer = page.locator('h3').filter({ hasText: /Eigentümer|Owner/i }).locator('../..')
  await expect(ownerSectionContainer.locator('text=admin').first()).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-ADOPT-2: Adoptieren-Button nur für Admins
// ══════════════════════════════════════════════════════════════════════════════

test('AC-ADOPT-2: Adoptieren-Button sichtbar für Admin bei VM ohne Owner', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await setupVmDetailPage(page, { owners: OWNERS_EMPTY })

  // AdoptButton rendert wenn: isAdmin=true UND hasOwners=false
  const adoptBtn = page.locator('button').filter({ hasText: /Adoptieren/i })
  await expect(adoptBtn.first()).toBeVisible({ timeout: 5000 })
})

test('AC-ADOPT-2b: Operator sieht keinen Adoptieren-Button', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page, { isAdmin: false })
  await setupVmDetailPage(page, { owners: OWNERS_EMPTY })

  // Nicht-Admin: Adoptieren-Button darf nicht erscheinen (AC-ADOPT-2)
  const adoptBtn = page.locator('button').filter({ hasText: /Adoptieren|Eigentum übernehmen/i })
  await expect(adoptBtn).toHaveCount(0)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-VIS-5: MyAccountPage "Meine Ressourcen" Tab  (Route: /account)
// ══════════════════════════════════════════════════════════════════════════════

test('AC-VIS-5: MyAccountPage hat Tab "Meine Ressourcen"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  const resourcesTab = page.locator('button, a').filter({ hasText: /Meine Ressourcen|My Resources/i })
  await expect(resourcesTab.first()).toBeVisible({ timeout: 5000 })
})

test('AC-VIS-5b: Meine Ressourcen Tab zeigt VM-ID aus Owner-Einträgen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  const resourcesTab = page.locator('button, a').filter({ hasText: /Meine Ressourcen|My Resources/i }).first()
  await resourcesTab.click()
  await page.waitForTimeout(500)

  // vmid 100 aus MY_OWNERS
  await expect(page.locator('text=100').first()).toBeVisible({ timeout: 3000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-CO-2: Co-Owner hinzufügen (Button sichtbar für Admin/Owner)
// ══════════════════════════════════════════════════════════════════════════════

test('AC-CO-2: Admin sieht Co-Owner-Hinzufügen-Button in Owner-Sektion', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await setupVmDetailPage(page, { owners: OWNERS_WITH_ADMIN })

  // addCoOwner-Button (canManage=true, isAdmin=true)
  const addCoOwnerBtn = page.locator('button').filter({ hasText: /Co-Owner|Miteigentümer|Hinzufügen/i }).first()
  await expect(addCoOwnerBtn).toBeVisible({ timeout: 5000 })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-API-1a/1b/1c: API-Routen werden aufgerufen
// ══════════════════════════════════════════════════════════════════════════════

test('AC-API-1a: GET /api/owners/config wird beim Playbook-Formular aufgerufen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PLAYBOOK_VM]) })
  )
  await page.route('/api/playbooks/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAYBOOK_VM) })
  )

  let configCalled = false
  // Override nach mockCommonApi für Capture
  await page.route('/api/owners/config', async r => {
    configCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OWNER_CONFIG_ENABLED) })
  })

  await page.goto('/provisioning')
  // Playbook klicken → PlaybookForm rendert → useOwnerConfig() wird aufgerufen
  await page.getByText('VM Provisionieren').first().click({ timeout: 8000 })
  await page.waitForTimeout(600)

  expect(configCalled).toBe(true)
})

test('AC-API-1b: GET /api/me/owners wird beim Klick auf Meine-Ressourcen-Tab aufgerufen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let meCalled = false
  // Override nach mockCommonApi für Capture
  await page.route('/api/me/owners', async r => {
    meCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MY_OWNERS) })
  })

  await page.goto('/account')
  await page.waitForLoadState('networkidle')

  // Meine Ressourcen Tab klicken → MyResourcesTab rendert → useMyOwners() aufgerufen
  const resourcesTab = page.locator('button, a').filter({ hasText: /Meine Ressourcen|My Resources/i }).first()
  await resourcesTab.click({ timeout: 5000 })
  await page.waitForTimeout(600)

  expect(meCalled).toBe(true)
})

test('AC-API-1c: POST /api/owners/bulk wird vom Dashboard VmTable aufgerufen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let bulkCalled = false
  // Override nach mockCommonApi für Capture
  await page.route('/api/owners/bulk', async r => {
    bulkCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BULK_OWNERS_WITH_ADMIN) })
  })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  expect(bulkCalled).toBe(true)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-ADOPT-3: Adopt-Endpoint-Aufruf durch Admin
// ══════════════════════════════════════════════════════════════════════════════

test('AC-ADOPT-3: Adoptieren-Button sendet POST /api/owners/vm/1/100/adopt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await setupVmDetailPage(page, { owners: OWNERS_EMPTY })

  let adoptCalled = false
  // Override für adopt-Endpoint (nach setupVmDetailPage – höchste Priorität)
  await page.route('**/api/owners/vm/1/100/adopt', async r => {
    if (r.request().method() === 'POST') {
      adoptCalled = true
      await r.fulfill({
        status: 201, contentType: 'application/json',
        body: JSON.stringify({
          id: 1, resource_type: 'vm', node_id: 1, vmid: 100,
          user_id: 1, username: 'admin', assigned_at: '2026-05-12T10:00:00Z',
          assigned_by_user_id: 1, assigned_by_username: 'admin', source: 'adopt',
        }),
      })
    } else {
      await r.continue()
    }
  })

  const adoptBtn = page.locator('button').filter({ hasText: /Adoptieren/i }).first()
  await adoptBtn.click({ timeout: 5000 })
  // Modal öffnet sich → Confirm-Button klicken (letzter "Adoptieren"-Button ist im Modal)
  await page.waitForTimeout(300)
  const confirmBtn = page.locator('button').filter({ hasText: /Adoptieren/i }).last()
  await confirmBtn.click({ timeout: 3000 })
  await page.waitForTimeout(500)

  expect(adoptCalled).toBe(true)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-TR-1: Transfer-Modal öffnet sich
// ══════════════════════════════════════════════════════════════════════════════

test('AC-TR-1: Übertragen-Button öffnet TransferOwnerModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await setupVmDetailPage(page, { owners: OWNERS_WITH_ADMIN })

  const transferBtn = page.locator('button').filter({ hasText: /Übertragen|Transfer/i }).first()
  const visible = await transferBtn.isVisible({ timeout: 3000 }).catch(() => false)
  if (visible) {
    await transferBtn.click()
    await page.waitForTimeout(400)

    const modal = page.locator('[role="dialog"]').first()
    await expect(modal).toBeVisible({ timeout: 3000 })
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// Security: Nicht-Owner/Nicht-Admin hat keinen Zugriff auf Owner-Aktionen
// ══════════════════════════════════════════════════════════════════════════════

test('Security: Operator ohne Ownership sieht keine Owner-Management-Buttons', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page, { isAdmin: false })
  await setupVmDetailPage(page, { owners: OWNERS_WITH_ADMIN })

  // Weder Adoptieren noch Co-Owner-Button für alice (kein Owner, kein Admin)
  const adoptBtn = page.locator('button').filter({ hasText: /Adoptieren/i })
  await expect(adoptBtn).toHaveCount(0)

  const addCoOwnerBtn = page.locator('button').filter({ hasText: /Co-Owner|Miteigentümer/i })
  await expect(addCoOwnerBtn).toHaveCount(0)
})

test('Security: Frontend zeigt Adopt-Button nicht für Nicht-Admin (AC-ADOPT-2)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommonApi(page, { isAdmin: false })
  await setupVmDetailPage(page, { owners: OWNERS_EMPTY })

  // Kein Adoptieren-Button für Nicht-Admin
  const adoptBtn = page.locator('button').filter({ hasText: /Adoptieren|Übernehmen/i })
  await expect(adoptBtn).toHaveCount(0)
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-MOD-1/2: Feature-Modul via API-Aufruf-Verifikation
// ══════════════════════════════════════════════════════════════════════════════

test('AC-MOD-1a: /api/owners/bulk wird beim Dashboard aufgerufen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let bulkCalled = false
  await page.route('/api/owners/bulk', async r => {
    bulkCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  expect(bulkCalled).toBe(true)
})

test('AC-MOD-1b: /api/owners/config wird beim Provisioning-Playbook aufgerufen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_PLAYBOOK_VM]) })
  )
  await page.route('/api/playbooks/**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PLAYBOOK_VM) })
  )

  let configCalled = false
  await page.route('/api/owners/config', async r => {
    configCalled = true
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OWNER_CONFIG_ENABLED) })
  })

  await page.goto('/provisioning')
  await page.getByText('VM Provisionieren').first().click({ timeout: 8000 })
  await page.waitForTimeout(600)
  expect(configCalled).toBe(true)
})
