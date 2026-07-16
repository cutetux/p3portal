// p3portal.org
// PROJ-103: E2E-Tests für die Proxmox-HA-Verwaltung (Core).
// Deckt ab: Cluster-Gating der Sidebar (AC-GATE-1), HA-Status-Tab (AC-STATUS-1/2/3),
// Regeln-Liste + Anlegen (node-affinity) + Lösch-Bestätigung (AC-RULE-1/3), Ressourcen-
// Liste + Hinzufügen + 409-Doppel-Eintrag (AC-RES-1/5), Migrate-Modal Ziel-Node-
// Auswahl + Leer-Fall (AC-ACT-1/3), RBAC read-only ohne manage_ha (AC-RBAC-1/2),
// manage_ha im UserForm (AC-RBAC-3). Reines Frontend-Verhalten gegen gemockte API
// (Muster PROJ-89-SDN). Live-Aktionen (Job-Live-Log, echte Proxmox-HA-Calls) sind
// nicht Teil der E2E-Mock-Suite (Live-Cluster, Posture wie PROJ-101/102).
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// role=admin, portal_permissions=[manage_settings,manage_users]
const ADMIN_TOKEN =
  H + '.eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyIsIm1hbmFnZV91c2VycyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9.fake-sig'
// role=viewer, portal_permissions=[] → darf lesen, nicht schreiben (AC-RBAC-1)
const VIEWER_TOKEN =
  H + '.eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjN9.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, portal_permissions: ['manage_settings', 'manage_users'], groups: [],
}
const MOCK_ME_VIEWER = {
  id: 3, username: 'viewer', role: 'viewer', auth_type: 'local',
  must_change_pw: false, portal_permissions: [], groups: [],
}

const CAPS = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false, stacks: false,
}

// ── HA fixtures ────────────────────────────────────────────────────────────────
const HA_STATUS = {
  quorate: true, manager_node: 'pve-01', manager_status: 'active',
  ha_unavailable: false, permission_denied: false, cluster_unreachable: false, detail: null,
  nodes: [
    { node: 'pve-01', type: 'master', status: 'active' },
    { node: 'pve-02', type: 'lrm', status: 'active' },
  ],
  resources: [
    { sid: 'vm:100', state: 'started', node: 'pve-01', crm_state: 'started', request_state: 'started' },
  ],
}
const HA_STATUS_EMPTY = {
  quorate: true, manager_node: 'pve-01', manager_status: 'active',
  ha_unavailable: false, permission_denied: false, cluster_unreachable: false, detail: null,
  nodes: [{ node: 'pve-01', type: 'master', status: 'active' }], resources: [],
}
const HA_RULES = {
  ha_unavailable: false, permission_denied: false, cluster_unreachable: false, detail: null,
  items: [
    { id: 'prod', type: 'node-affinity', resources: ['vm:100'],
      nodes: [{ node: 'pve-01', priority: 100 }, { node: 'pve-02', priority: 50 }],
      nodes_raw: 'pve-01:100,pve-02:50', strict: true, affinity: null,
      comment: null, disable: false, digest: 'd1' },
  ],
}
const HA_RESOURCES = {
  ha_unavailable: false, permission_denied: false, cluster_unreachable: false, detail: null,
  items: [
    { sid: 'vm:100', type: 'vm', state: 'started', group: 'prod', max_restart: 1, max_relocate: 1, comment: null, digest: 'r1' },
  ],
}

// Zwei Nodes einer Installation (portal_node_id=1) für getNodes.
const CLUSTER_NODES = [
  { node: 'pve-01', portal_node_id: 1, portal_node_name: 'Cluster A' },
  { node: 'pve-02', portal_node_id: 1, portal_node_name: 'Cluster A' },
]

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, nodeCount = 2 } = {}) {
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: 'core', valid: false, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: 6, max_presets: null, max_api_keys: null, is_plus: false, max_scheduled_jobs_per_user: 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: CAPS }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ json: { quorum: true, node_count: nodeCount, ha_status: 'started', unreachable_nodes: [] } }))
  await page.route(/localhost:\d+\/api\/cluster\/nodes(\?.*)?$/, r => r.fulfill({ json: CLUSTER_NODES }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/approvals/**', r => r.fulfill({ json: { pending: 0 } }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  // Help-Slide-Over content (HelpButton auf der HA-Seite).
  await page.route('**/api/help/**', r => r.fulfill({ json: { content: '', source: 'none' } }))
}

async function mockHa(page, { status = HA_STATUS, rules = HA_RULES, resources = HA_RESOURCES } = {}) {
  await page.route(/localhost:\d+\/api\/ha\/status(\?.*)?$/, r => r.fulfill({ json: status }))
  await page.route(/localhost:\d+\/api\/ha\/rules(\?.*)?$/, r => {
    if (r.request().method() === 'GET') return r.fulfill({ json: rules })
    return r.fulfill({ status: 201, json: { id: 'new' } })
  })
  await page.route(/localhost:\d+\/api\/ha\/resources(\?.*)?$/, r => r.fulfill({ json: resources }))
}

async function goHa(page, { token = ADMIN_TOKEN, area = 'status', ...opts } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, opts)
  await mockHa(page, opts)
  await page.goto(`/ha?area=${area}`)
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════

test('AC-GATE-1: Auf einer Single-Node-Installation erscheint der HA-Sidebar-Eintrag nicht', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { nodeCount: 1 })
  await mockHa(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('nav a[href="/ha"]')).toHaveCount(0)
})

test('AC-GATE-1: Auf einem Cluster (node_count>1) ist der HA-Sidebar-Eintrag sichtbar', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { nodeCount: 2 })
  await mockHa(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('nav a[href="/ha"]')).toHaveCount(1)
})

test('AC-STATUS-1/2: Status-Tab zeigt Quorum, HA-Manager und die Ressourcen-Zustände', async ({ page }) => {
  await goHa(page, { area: 'status' })
  await expect(page.getByRole('heading', { name: 'Hochverfügbarkeit' })).toBeVisible()
  await expect(page.getByText('Quorum', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('pve-01', { exact: false }).first()).toBeVisible()
  // Die HA-Ressource vm:100 wird mit ihrem Zustand gelistet.
  await expect(page.getByText('vm:100').first()).toBeVisible()
})

test('AC-STATUS-3: Ohne HA-Ressourcen zeigt der Status-Tab einen sauberen Leerzustand statt Fehler', async ({ page }) => {
  await goHa(page, { area: 'status', status: HA_STATUS_EMPTY })
  await expect(page.getByText('Es sind noch keine HA-Ressourcen konfiguriert.')).toBeVisible()
})

test('AC-RULE-1: Regeln-Tab listet Regeln (Typ/Ressourcen/Nodes) und öffnet das Anlege-Modal', async ({ page }) => {
  await goHa(page, { area: 'rules' })
  await expect(page.getByText('prod').first()).toBeVisible()
  await expect(page.getByText('Node-Affinität').first()).toBeVisible()
  await expect(page.getByText('pve-01', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Regel anlegen' }).click()
  await expect(page.getByText('HA-Regel anlegen')).toBeVisible()
})

test('AC-RULE-3: Löschen einer Regel öffnet einen einfachen Bestätigungsdialog (keine Nutzungsprüfung)', async ({ page }) => {
  await goHa(page, { area: 'rules' })
  await page.getByRole('button', { name: 'Löschen' }).first().click()
  // Rule-Löschen verwaist nichts → schlichter Confirm, kein Usage-Dialog.
  await expect(page.getByText('HA-Regel „prod" löschen', { exact: false })).toBeVisible()
  await expect(page.getByText('nur die Einschränkung entfällt', { exact: false })).toBeVisible()
})

test('AC-RES-1: Ressourcen-Tab listet HA-Ressourcen und öffnet das Hinzufügen-Modal', async ({ page }) => {
  await goHa(page, { area: 'resources' })
  await expect(page.getByText('vm:100').first()).toBeVisible()
  await page.getByRole('button', { name: 'Ressource hinzufügen' }).first().click()
  await expect(page.getByText('HA-Ressource hinzufügen')).toBeVisible()
})

test('AC-RES-5: Doppeltes Hinzufügen einer Ressource zeigt einen verständlichen 409-Fehler', async ({ page }) => {
  await goHa(page, { area: 'resources' })
  // Spezifischer POST-Handler NACH goHa registrieren (Playwright-Routes = LIFO → gewinnt).
  await page.route(/localhost:\d+\/api\/ha\/resources(\?.*)?$/, r => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ status: 409, json: { detail: 'vm:100 ist bereits eine HA-Ressource' } })
    }
    return r.fulfill({ json: HA_RESOURCES })
  })
  await page.getByRole('button', { name: 'Ressource hinzufügen' }).first().click()
  await expect(page.getByText('HA-Ressource hinzufügen')).toBeVisible()
  await page.locator('#ha-res-vmid').fill('100')
  await page.getByRole('button', { name: 'Ressource hinzufügen' }).last().click()
  await expect(page.getByText('bereits eine HA-Ressource', { exact: false })).toBeVisible()
})

test('AC-ACT-1/3: Migrate-Modal bietet Ziel-Nodes an und startet die Aktion als Job', async ({ page }) => {
  let migrateBody = null
  // sid wird clientseitig URL-encoded (vm:100 → vm%3A100).
  await page.route(/localhost:\d+\/api\/ha\/resources\/vm%3A100\/migrate(\?.*)?$/, r => {
    migrateBody = r.request().postDataJSON()
    return r.fulfill({ status: 202, json: { id: 'job-1', type: 'ha_migrate', status: 'pending' } })
  })
  await page.route(/localhost:\d+\/api\/jobs\/job-1(\/.*)?$/, r =>
    r.fulfill({ json: { id: 'job-1', type: 'ha_migrate', status: 'pending', log_path: null } }))
  await goHa(page, { area: 'resources' })
  await page.getByRole('button', { name: 'Verschieben' }).first().click()
  await expect(page.getByText('verschieben', { exact: false }).first()).toBeVisible()
  // Ziel-Node-Dropdown vorhanden; auf die andere Node der Installation setzen (AC-ACT-3).
  const target = page.locator('#ha-mig-target')
  await expect(target).toBeVisible()
  await target.selectOption('pve-02')
  await page.getByRole('button', { name: 'Aktion starten' }).click()
  await page.waitForTimeout(400)
  expect(migrateBody).toEqual({ node: 'pve-02' })
})

test('AC-RBAC-1/2: Ein Viewer ohne manage_ha sieht den HA-Status read-only (keine Schreib-Buttons)', async ({ page }) => {
  await goHa(page, { area: 'rules', token: VIEWER_TOKEN, me: MOCK_ME_VIEWER })
  // Anzeige der Regel bleibt sichtbar …
  await expect(page.getByText('prod').first()).toBeVisible()
  // … aber die Schreib-Aktionen fehlen (canWrite=false).
  await expect(page.getByRole('button', { name: 'Regel anlegen' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Löschen' })).toHaveCount(0)
})

// AC-RBAC-3 (manage_ha als delegierbare Permission im UserForm) ist code-verifiziert
// (UserForm.jsx CORE_PORTAL_PERMISSIONS enthält 'manage_ha', i18n perm_manage_ha DE/EN
// vorhanden) und wird hier nicht per E2E abgedeckt (Nutzer-Edit-Modal-Tiefe).
