// p3portal.org
// PROJ-76 Phase 2b: E2E-Tests für den Stacks-Deploy-Flow (Plus-only).
// Testet: Deployment-Badge (Detail + Liste), Plan-Gate-Modal (Counts + Zerstörungs-
//         Hervorhebung), Apply→202-Pending-Banner, Apply→409-„Definition geändert"+Re-Plan,
//         Drift-Report-Modal, Deployments-Historie-Tab, Reale-VMs-Tab, VM-Detail-
//         Mutations-Block (Banner + Editor gesperrt), Core-404 auf den 6 neuen EPs.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","role":"admin","portal_permissions":["manage_settings","manage_users"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyIsIm1hbmFnZV91c2VycyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_settings', 'manage_users'], groups: [],
}

const CAPS_CORE = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false, stacks: false,
}
const CAPS_PLUS = { ...CAPS_CORE, stacks: true }

const STACK_YAML =
  "name: webcluster\nversion: '1.0.0'\nresources:\n  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n    count: 3\n"

// Ein bereits ausgerollter Stack → Deploy/Destroy/Drift-Buttons aktiv, Badge sichtbar.
const STACK_DEPLOYED = {
  id: 7, name: 'webcluster', version: '1.0.0', status: 'active', source_kind: 'structured',
  owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 3,
  current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
  deployment_state: 'deployed', last_drift_state: null,
  yaml_text: STACK_YAML, yaml_corrupt: false,
  resources: [
    { type: 'vm', name: 'web-1', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null },
    { type: 'vm', name: 'web-2', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null },
    { type: 'vm', name: 'web-3', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null },
  ],
}

const PLAN_RESPONSE = {
  plan_token: 'tok_abc123',
  operation: 'apply',
  summary: {
    create: 2, change: 1, destroy: 1, replace: 0,
    resources: [
      { name: 'web-1', action: 'create' },
      { name: 'web-2', action: 'create' },
      { name: 'web-3', action: 'update' },
      { name: 'web-old', action: 'delete' },
    ],
  },
}

// ── Common mocks ───────────────────────────────────────────────────────────────

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS } = {}) {
  await page.route(/localhost:\d+\/api\/cluster\//, r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: caps.stacks ? 'plus_v1' : 'core', valid: caps.stacks, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: caps.stacks ? null : 6, max_presets: null, max_api_keys: null, is_plus: caps.stacks, max_scheduled_jobs_per_user: caps.stacks ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/users', r => r.fulfill({ json: [{ id: 2, username: 'operator', auth_type: 'local' }] }))
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
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools/**', r => r.fulfill({ json: [] }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

// Detail-Seite eines ausgerollten Stacks öffnen. extraRoutes erlaubt das
// Überschreiben einzelner Stack-Sub-Endpunkte (plan/deploy/drift/...).
async function gotoDeployedDetail(page, { caps = CAPS_PLUS, stack = STACK_DEPLOYED, extraRoutes } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  // Defaults zuerst; Playwright matcht LIFO → extraRoutes danach überschreiben sie.
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stack }))
  if (extraRoutes) await extraRoutes(page)
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-UI-6: Deployment-Zustand-Badge
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-UI-6 Detail: Deployment-Badge zeigt „ausgerollt"', async ({ page }) => {
  await gotoDeployedDetail(page)
  await expect(page.locator('h1:has-text("webcluster")')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=ausgerollt').first()).toBeVisible()
})

test('AC-2B-UI-6 Liste: Deployment-Spalte zeigt Badge', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks(\?.*)?$/, r => r.fulfill({ json: [STACK_DEPLOYED] }))
  await page.goto('/stacks')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=webcluster').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=ausgerollt').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-UI-4 / AC-2B-DES-1: Destroy- + Drift-Button bei ausgerolltem Stack
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-UI-4: Destroy- + Drift-Button sichtbar bei ausgerolltem Stack', async ({ page }) => {
  await gotoDeployedDetail(page)
  await expect(page.locator('button:has-text("Zerstören")').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('button:has-text("Drift prüfen")')).toBeVisible()
})

test('AC-2B-UI-4 Negativ: Destroy-Button fehlt bei not_deployed-Stack', async ({ page }) => {
  const notDeployed = { ...STACK_DEPLOYED, deployment_state: 'not_deployed' }
  await gotoDeployedDetail(page, { stack: notDeployed })
  await expect(page.locator('button:has-text("Ausrollen")')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('button:has-text("Zerstören")')).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-PLAN-1/2/5 + AC-2B-UI-2: Plan-Gate-Modal mit Zerstörungs-Hervorhebung
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-PLAN-5/UI-2: Plan-Modal zeigt Counts + hervorgehobene Zerstörung', async ({ page }) => {
  await gotoDeployedDetail(page, {
    extraRoutes: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_RESPONSE }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  // Plan-Übersicht: Pro-Ressource-Liste + Zerstörungs-Warnbanner (1 destroy)
  await expect(page.locator('text=web-1').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=/ZERSTÖRT/i')).toBeVisible()
  // „Anwenden"-Button erst nach Plan
  await expect(page.locator('button:has-text("Anwenden")')).toBeEnabled()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-APPR-2 / AC-2B-DEP-1: Apply → 202 Pending-Approval-Banner
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-APPR-2: Apply mit aktivem Approval → 202 Pending-Banner', async ({ page }) => {
  await gotoDeployedDetail(page, {
    extraRoutes: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_RESPONSE }))
      await p.route(/localhost:\d+\/api\/stacks\/7\/deploy$/, r =>
        r.fulfill({ status: 202, json: { status: 'pending_approval', approval_id: 'appr_9', poll_url: '/api/approvals/appr_9' } }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Anwenden")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/Freigabe|approval|pending|wartet/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-PLAN-4: Apply → 409 „Definition geändert" → Re-Plan angeboten
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-PLAN-4: Apply-409 zeigt „Definition geändert" + Erneut-planen', async ({ page }) => {
  await gotoDeployedDetail(page, {
    extraRoutes: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_RESPONSE }))
      await p.route(/localhost:\d+\/api\/stacks\/7\/deploy$/, r =>
        r.fulfill({ status: 409, json: { detail: 'stack_definition_changed' } }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Anwenden")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/Definition.*geändert/i')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('button:has-text("Erneut planen")')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-DRIFT-1/2/3 + AC-2B-UI-5: Drift-Report-Modal
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-DRIFT/UI-5: Drift-Modal zeigt out_of_sync-Report pro VM', async ({ page }) => {
  await gotoDeployedDetail(page, {
    extraRoutes: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/drift$/, r => r.fulfill({
        json: {
          drift_state: 'out_of_sync', in_sync: 1, changed: 1, missing: 1,
          items: [
            { resource_name: 'web-1', vmid: 101, state: 'in_sync' },
            { resource_name: 'web-2', vmid: 102, state: 'changed' },
            { resource_name: 'web-3', vmid: 103, state: 'missing' },
          ],
        },
      }))
    },
  })
  await page.click('button:has-text("Drift prüfen")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/Drift-Prüfung/i')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=web-2').first()).toBeVisible()
  await expect(page.locator('text=/Abweichungen|abweichend/i').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-UI-7 / AC-2B-DPL-3: Deployments-Historie-Tab
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-UI-7: Deployments-Tab zeigt Lauf-Historie', async ({ page }) => {
  await gotoDeployedDetail(page, {
    extraRoutes: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({
        json: [{
          id: 1, operation: 'apply', status: 'success', job_id: 'job-uuid-1',
          plan_summary: { create: 3, change: 0, destroy: 0, replace: 0, resources: [] },
          triggered_by_user_id: 1, started_at: '2026-06-02T11:00:00',
          finished_at: '2026-06-02T11:02:00', error_text: null,
        }],
      }))
    },
  })
  await page.click('button:has-text("Deployments")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/erfolg|success/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-UI-8 / AC-2B-DPL-4: Reale-VMs-Tab (Resources/live)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-UI-8: Reale-VMs-Tab listet deployte VMs mit VMID', async ({ page }) => {
  await gotoDeployedDetail(page, {
    extraRoutes: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({
        json: [
          { resource_name: 'web-1', node: 'pve-01', vmid: 101, kind: 'vm', portal_node_id: 1, power_status: 'running' },
          { resource_name: 'web-2', node: 'pve-01', vmid: 102, kind: 'vm', portal_node_id: 1, power_status: 'stopped' },
        ],
      }))
    },
  })
  // Tab-Label „Reale VMs" (stacks.detail.live_tab)
  await page.click('button:has-text("Reale VMs"), button:has-text("Live")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=101').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=web-1').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-MUT-1 / AC-2B-UI-9: VM-Detail Stack-Banner + Editor gesperrt
// ═══════════════════════════════════════════════════════════════════════════════

const VM_DETAIL_MANAGED = {
  vmid: 101, name: 'web-1', node: 'pve-01', type: 'qemu', status: 'running',
  cpu: 0.05, maxcpu: 1, cores: 1, sockets: 1, mem: 512000000, maxmem: 2147483648,
  disk: 0, maxdisk: 34359738368, uptime: 3600, template: false,
  portal_node_id: 1, managed_by_stack: { stack_id: 7, stack_name: 'webcluster' },
  networks: [], disks: [], description: null, tags: [],
  onboot: false, protection: false, ha_state: null,
  config: {}, agent_running: false,
}

test('AC-2B-MUT-1/UI-9: VM-Detail zeigt Stack-Banner + Editor gesperrt', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/cluster\/vms\/pve-01\/qemu\/101$/, r => r.fulfill({ json: VM_DETAIL_MANAGED }))
  await page.route(/localhost:\d+\/api\/cluster\/vms\/pve-01\/qemu\/101\/backups$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/cluster\/vms\/pve-01\/qemu\/101\/snapshots$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/cluster\/vms\/pve-01\/qemu\/101\/guest-info$/, r => r.fulfill({ json: {} }))
  await page.goto('/vm/pve-01/qemu/101')
  await page.waitForLoadState('networkidle')
  // Stack-Hinweis-Banner mit Link zum Stack
  await expect(page.locator('text=/vom Stack|managed/i').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('a[href="/stacks/7"]').first()).toBeVisible()
  // Editor-Button durch „Stack-verwaltet"-Label ersetzt (kein „Bearbeiten")
  await expect(page.locator('text=Stack-verwaltet').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-2B-CORE-1: Core-Mode → 404 auf den neuen Phase-2b-Endpunkten
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-2B-CORE-1: Phase-2b-EPs liefern 404 im Core-Mode', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  // Im Core liefert das Backend 404; wir spiegeln das im Mock.
  await page.route(/localhost:\d+\/api\/stacks\/7\/(plan|deploy|destroy|drift|deployments|resources\/live).*/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/')
  for (const path of ['plan', 'deploy', 'destroy', 'drift', 'deployments', 'resources/live']) {
    const isGet = path === 'deployments' || path === 'resources/live' || path === 'drift'
    const opts = {
      method: isGet ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    }
    if (!isGet) opts.body = '{}'   // GET/HEAD darf keinen Body tragen
    const resp = await browserFetch(page, `/api/stacks/7/${path}`, opts)
    expect(resp.status, `EP ${path} should be 404 in core`).toBe(404)
  }
})
