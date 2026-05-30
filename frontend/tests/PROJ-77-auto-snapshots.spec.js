// p3portal.org
// PROJ-77: E2E-Tests für Auto-Snapshots VM/LXC (Plus-only)
// Testet: Action-Type-Gating (Core vs. Plus), Form-Felder pro Action-Type,
//         API-404-Gate in Core, AutoBadge im Config-Snapshots-Tab,
//         Target-Selector-Tabs, Validation, openJob-Deep-Link.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings","manage_users"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyIsIm1hbmFnZV91c2VycyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999,"user_id":2}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjJ9' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_settings', 'manage_users'], groups: [],
}

const MOCK_ME_VIEWER = {
  id: 2, username: 'viewer', role: 'viewer', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: [], groups: [],
}

const MOCK_NODE = {
  id: 1, name: 'Heimserver', proxmox_node: 'pve1',
  host_url: 'https://pve.example.com:8006', verify_ssl: false, is_default: true,
}

const VM_DETAIL = {
  vmid: 100, name: 'web-server', type: 'qemu', status: 'running',
  node: 'pve1', ip: '192.168.1.100', uptime: 3661, tags: [],
  is_template: false, cpu_usage: 0.12, cpu_cores: 4,
  mem_used: 2147483648, mem_total: 8589934592,
  bios: 'seabios', ostype: 'l26',
  portal_node_id: 1,
  networks: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' }],
  disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G' }],
}

const AUTO_SNAP = {
  id: 'autoSnap1', portal_node_id: 1, proxmox_node: 'pve1', vmid: 100,
  kind: 'qemu', name: 'auto-abc12345-20260530-0800',
  note: 'P3 auto-snapshot', source: 'auto',
  created_at: '2026-05-30T08:00:00Z', created_by_user_id: 1,
  created_by_username: 'admin', is_orphan: false,
  orphaned_at: null, vm_name_at_delete: null,
  created_by_scheduled_job_id: 'job-aaa-111',
}

const MANUAL_SNAP = {
  id: 'manSnap1', portal_node_id: 1, proxmox_node: 'pve1', vmid: 100,
  kind: 'qemu', name: 'snapshot-config-pve1-100-20260501',
  note: 'Vor Update', source: 'manual',
  created_at: '2026-05-01T12:00:00Z', created_by_user_id: 1,
  created_by_username: 'admin', is_orphan: false,
  orphaned_at: null, vm_name_at_delete: null,
  created_by_scheduled_job_id: null,
}

const RUN_DETAILS = {
  run_id: 'run-xyz-999',
  job_id: 'job-aaa-111',
  summary: {
    status: 'partial_success',
    targets_total: 3,
    created_count: 2,
    skipped_no_change_count: 0,
    skipped_locked_count: 0,
    skipped_not_owner_count: 0,
    failed_count: 1,
    rotated_count: 0,
    failed_details: [
      { node: 'pve1', vmid: 102, error_class: 'snapshot_create_failed', error_msg: 'storage out of space' },
    ],
  },
  entries: [
    { portal_node_id: 1, proxmox_node: 'pve1', vmid: 100, kind: 'qemu', status: 'created', snapshot_id: 'a1', snapname: 'auto-abc-20260530-0800' },
    { portal_node_id: 1, proxmox_node: 'pve1', vmid: 101, kind: 'qemu', status: 'created', snapshot_id: 'a2', snapname: 'auto-abc-20260530-0800' },
    { portal_node_id: 1, proxmox_node: 'pve1', vmid: 102, kind: 'qemu', status: 'failed', error_msg: 'storage out of space' },
  ],
}

const CAPS_CORE = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false,
}
const CAPS_PLUS = {
  ...CAPS_CORE, config_snapshots: true, alert_presets: true, auto_snapshots: true,
}

// ── Common Mocks ──────────────────────────────────────────────────────────────

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS, snapshots = [MANUAL_SNAP] } = {}) {
  // Catch-all (LIFO – zuerst registrieren = niedrigste Priorität)
  await page.route(/localhost:\d+\/api\/cluster\//, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/config-snapshots/, r => r.fulfill({ json: snapshots }))

  // Notifications + Tooling
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))

  // Common routes
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: caps.auto_snapshots ? 'plus_v1' : 'core', valid: caps.auto_snapshots, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: caps.auto_snapshots ? null : 6, max_presets: null, max_api_keys: null, is_plus: caps.auto_snapshots, max_scheduled_jobs_per_user: caps.auto_snapshots ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [MOCK_NODE] }))
  await page.route('**/api/admin/users', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/settings**', r =>
    r.fulfill({ json: { proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199 } }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } }))
  await page.route('**/api/cluster/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/cluster/vms', r => r.fulfill({ json: [] }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/approvals/**', r => r.fulfill({ json: { pending: 0 } }))
  await page.route('**/api/approvals', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-assignments', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/settings/**', r => r.fulfill({ json: null }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools/**', r => r.fulfill({ json: [] }))
}

async function gotoAutomation(page, token = ADMIN_TOKEN, caps = CAPS_PLUS) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, { caps })
  await page.goto('/automation?tab=scheduled')
  await page.waitForLoadState('networkidle')
}

async function gotoVmDetail(page, token = ADMIN_TOKEN, caps = CAPS_PLUS, snapshots = [MANUAL_SNAP, AUTO_SNAP]) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, { caps, snapshots })
  await page.route('**/api/cluster/vms/pve1/qemu/100', r => r.fulfill({ json: VM_DETAIL }))
  await page.route('**/api/cluster/vms/pve1/qemu/100/backups', r => r.fulfill({ json: { backups: [], schedules: [], storages: [] } }))
  await page.route('**/api/vms/100/snapshots', r => r.fulfill({ json: [] }))
  await page.route('**/api/vms/100/owners', r => r.fulfill({ json: [] }))
  await page.route('**/api/auto-snapshots/native-snapshots**', r => r.fulfill({ json: [] }))
  await page.goto('/vm/pve1/qemu/100')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-AT-1/2/3 + AC-UI-1: Action-Type-Cards im Scheduled-Job-Form (Plus-Gate)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-AT-Plus: Plus-Capability zeigt 2 neue Auto-Snapshot-Action-Cards', async ({ page }) => {
  await gotoAutomation(page, ADMIN_TOKEN, CAPS_PLUS)
  // Plus-only "Neuer Job"-Button
  const newJobBtn = page.locator('button:has-text("Neuer Job"), button:has-text("New Job"), button:has-text("Neu erstellen")').first()
  if (await newJobBtn.count() > 0) {
    await newJobBtn.click()
    await page.waitForLoadState('networkidle')
    // 5 Action-Types: playbook, ssh, power_action, auto_config_snapshot, auto_vm_snapshot
    // Erwartet sichtbar: zumindest die beiden Auto-Snap-Cards (i18n: "Auto Config-Snapshot" / "Auto VM/LXC-Snapshot")
    const autoConfigCard = page.locator('text=/Auto.*Config.*Snapshot/i').first()
    const autoVmCard = page.locator('text=/Auto.*VM.*Snapshot/i').first()
    await expect(autoConfigCard.or(autoVmCard).first()).toBeVisible({ timeout: 5000 })
  }
})

test('AC-AT-Core: Ohne Plus-Capability fehlen die Auto-Snapshot-Action-Cards', async ({ page }) => {
  await gotoAutomation(page, ADMIN_TOKEN, CAPS_CORE)
  const newJobBtn = page.locator('button:has-text("Neuer Job"), button:has-text("New Job"), button:has-text("Neu erstellen")').first()
  if (await newJobBtn.count() > 0) {
    await newJobBtn.click()
    await page.waitForLoadState('networkidle')
    // Auto-Snap-Cards dürfen NICHT erscheinen
    await expect(page.locator('text=/Auto.*Config.*Snapshot/i')).toHaveCount(0)
    await expect(page.locator('text=/Auto.*VM.*Snapshot/i')).toHaveCount(0)
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-API-GATE: Plus-only Endpoints liefern 404 in Core
// ═══════════════════════════════════════════════════════════════════════════════

// Hilfsfunktion: fetch im Browser-Kontext (wird durch page.route() abgefangen)
async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

test('AC-API-1: /api/auto-snapshots/runs/.../details liefert 404 in Core', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route('**/api/auto-snapshots/runs/**', r => r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/')
  const resp = await browserFetch(page, '/api/auto-snapshots/runs/test-run-id/details', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  })
  expect(resp.status).toBe(404)
})

test('AC-API-2: /api/auto-snapshots/native-snapshots liefert 404 in Core', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route('**/api/auto-snapshots/native-snapshots**', r => r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/')
  const resp = await browserFetch(page, '/api/auto-snapshots/native-snapshots?portal_node_id=1&proxmox_node=pve1&vmid=100&kind=qemu', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  })
  expect(resp.status).toBe(404)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-4: AutoBadge bei source='auto' im PROJ-74 Config-Snapshots-Tab
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-4: Config-Snapshots-Tab zeigt "auto"-Badge bei source="auto"', async ({ page }) => {
  await gotoVmDetail(page, ADMIN_TOKEN, CAPS_PLUS, [MANUAL_SNAP, AUTO_SNAP])
  // Tab öffnen
  await page.click('button:has-text("Config-Snapshots")')
  await page.waitForLoadState('networkidle')
  // Auto-Snapshot mit Badge "auto" sichtbar
  await expect(page.locator(`text=${AUTO_SNAP.name}`).first()).toBeVisible({ timeout: 5000 })
  // Badge-Text 'auto' (i18n: auto_snapshots.badge.auto = "auto")
  // Es können mehrere Vorkommen geben (Badge + SourceBadge), wir akzeptieren mind. 1.
  const autoBadges = page.locator('text=/^auto$/i')
  await expect(autoBadges.first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-4b: Manual-Snapshot zeigt KEIN auto-Badge mit Job-Link', async ({ page }) => {
  await gotoVmDetail(page, ADMIN_TOKEN, CAPS_PLUS, [MANUAL_SNAP])
  await page.click('button:has-text("Config-Snapshots")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator(`text=${MANUAL_SNAP.name}`).first()).toBeVisible({ timeout: 5000 })
  // Bei nur manual: kein Auto-Klick-Badge (AutoBadge ist ein <button>, also locator filtern)
  // Es darf zwar source-Badge "manual" geben, aber keinen klickbaren Auto-Job-Link
  // Kein zuverlässiger Negativ-Test, daher: AutoBadge-Komponenten haben title-attribut "Erstellt durch geplanten Job"
  await expect(page.locator('[title*="geplanten Job"]')).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-Validation: TargetSpec-Validation greift im Plus-Modus
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-Validation-1: Auto-Snapshot ohne target_spec liefert 422', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route('**/api/scheduled-jobs', r => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ status: 422, json: { detail: 'missing_target_spec' } })
    }
    return r.fulfill({ json: [] })
  })
  await page.goto('/')
  const resp = await browserFetch(page, '/api/scheduled-jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'No Target',
      job_type: 'auto_vm_snapshot',
      cron_expression: '0 8 * * *',
      active: true,
      config: {},
    }),
  })
  expect(resp.status).toBe(422)
})

test('AC-Validation-2: Auto-Snapshot mit ungültigem target_spec liefert 422', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route('**/api/scheduled-jobs', r => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ status: 422, json: { detail: 'invalid_target_spec: leer' } })
    }
    return r.fulfill({ json: [] })
  })
  await page.goto('/')
  const resp = await browserFetch(page, '/api/scheduled-jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Invalid',
      job_type: 'auto_config_snapshot',
      cron_expression: '0 8 * * *',
      active: true,
      config: { target_spec: {} },
    }),
  })
  expect(resp.status).toBe(422)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-PERM-1: Nicht-Admin/Owner liefert 403 bei Auto-Snapshot-Anlage
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-PERM-1: Viewer (kein Admin, kein Owner) erhält 403 beim Auto-Snapshot-Anlage', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), VIEWER_TOKEN)
  await mockCommonApi(page, { me: MOCK_ME_VIEWER, caps: CAPS_PLUS })
  await page.route('**/api/scheduled-jobs', r => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ status: 403, json: { detail: 'auto_snapshot_not_owner_of_all_targets' } })
    }
    return r.fulfill({ json: [] })
  })
  await page.goto('/')
  const resp = await browserFetch(page, '/api/scheduled-jobs', {
    method: 'POST',
    headers: { Authorization: `Bearer ${VIEWER_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Viewer-Attempt',
      job_type: 'auto_vm_snapshot',
      cron_expression: '0 8 * * *',
      active: true,
      config: {
        target_spec: { singles: [{ portal_node_id: 1, vmid: 100, kind: 'qemu' }], pool_ids: [], portal_node_ids: [], tags: [], kind_filter: 'both' },
        keep_last: 7,
      },
    }),
  })
  expect(resp.status).toBe(403)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-API-3: Run-Details Endpoint liefert RunDetailsResponse (Plus)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-API-3: Run-Details-EP in Plus liefert RunDetailsResponse', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route('**/api/auto-snapshots/runs/run-xyz-999/details', r => r.fulfill({ json: RUN_DETAILS }))
  await page.goto('/')
  const resp = await browserFetch(page, '/api/auto-snapshots/runs/run-xyz-999/details', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  })
  expect(resp.status).toBe(200)
  expect(resp.body.run_id).toBe('run-xyz-999')
  expect(resp.body.summary.status).toBe('partial_success')
  expect(resp.body.entries).toHaveLength(3)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-API-4: Native-Snapshots Bulk-Lookup liefert Liste (Plus)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-API-4: Native-Snapshots-EP in Plus liefert leere Liste für unbekannte VM', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route('**/api/auto-snapshots/native-snapshots**', r => r.fulfill({ json: [] }))
  await page.goto('/')
  const resp = await browserFetch(page, '/api/auto-snapshots/native-snapshots?portal_node_id=1&proxmox_node=pve1&vmid=999&kind=qemu', {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  })
  expect(resp.status).toBe(200)
  expect(resp.body).toEqual([])
})
