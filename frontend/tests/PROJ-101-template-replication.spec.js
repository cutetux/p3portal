// p3portal.org
// PROJ-101 — Template-Replikation über Nodes (Plus)
// E2E gegen die Zeilen-Aktion „Replizieren" im ProxmoxTemplatesTab (Image Factory):
// Sichtbarkeit/RBAC/Edition-Gate + Replikations-Modal (Preflight, kein-Op, Ziel-/
// Storage-Wahl, Plan-Vorschau N→1, Start → Job → Live-Log).
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures (Base64-Payload ohne echte Signatur, useAuth liest role) ──
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'
// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":["replicate_templates"],"exp":9999999999}
const OPERATOR_PERM_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbInJlcGxpY2F0ZV90ZW1wbGF0ZXMiXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'
// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Templates (proxmox-templates-Liste) ─────────────────────────────────
const QEMU_TMPL = { vmid: 900, name: 'deb12', type: 'qemu', node: 'pve1', ctime: 1714003200 }
const LXC_TMPL = { vmid: 901, name: 'ct-base', type: 'lxc', node: 'pve1', ctime: 1714003200 }

// ── Preflight-Antworten ──────────────────────────────────────────────────────
const PREFLIGHT_LOCAL = {
  source_node: 'pve1', source_vmid: 900, source_name: 'deb12',
  is_template: true, source_shared: false, source_storage: 'local-lvm',
  single_node: false,
  targets: [
    { node: 'pve2', storages: [
      { name: 'local-lvm', type: 'lvmthin', shared: false, avail: 50 * 1024 ** 3, total: 100 * 1024 ** 3 },
      { name: 'ceph', type: 'rbd', shared: true, avail: 500 * 1024 ** 3, total: 1024 * 1024 ** 3 },
    ] },
    { node: 'pve3', storages: [
      { name: 'local-lvm', type: 'lvmthin', shared: false, avail: 40 * 1024 ** 3, total: 80 * 1024 ** 3 },
      { name: 'ceph', type: 'rbd', shared: true, avail: 500 * 1024 ** 3, total: 1024 * 1024 ** 3 },
    ] },
  ],
}
const PREFLIGHT_SHARED_SOURCE = {
  source_node: 'pve1', source_vmid: 900, source_name: 'deb12',
  is_template: true, source_shared: true, source_storage: 'ceph',
  single_node: false, targets: [],
}
const PREFLIGHT_SINGLE_NODE = {
  source_node: 'pve1', source_vmid: 900, source_name: 'deb12',
  is_template: true, source_shared: false, source_storage: 'local-lvm',
  single_node: true, targets: [],
}

// ── Helfer ────────────────────────────────────────────────────────────────────
async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockBaseApi(page, role, { capReplicate = true, templates = [QEMU_TMPL] } = {}) {
  await page.route('**/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: role, auth_type: 'local', role,
      must_change_pw: false, last_login_at: null, last_login_ip: null,
    }) }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ edition: 'plus', valid: true }) }))
  await page.route('**/api/capabilities', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      template_replication: capReplicate, extra_portal_permissions: ['replicate_templates'],
    }) }))
  await page.route('**/api/themes', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/announcements', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // Ein Packer-Node → Tab wählt automatisch aus und zeigt die Templates.
  await page.route('**/api/packer/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ name: 'pve1', status: 'online' }]) }))
  await page.route('**/api/packer/proxmox-templates', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(templates) }))
}

function mockPreflight(page, preflight) {
  return page.route(/\/api\/template-replication\/preflight/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(preflight) }))
}

const JOB = { id: 'job-repl-1', type: 'template_replication', status: 'pending',
  playbook: 'replicate:pve1/900', created_at: '2026-07-10T00:00:00Z', username: 'admin', params: {} }

async function goTab(page) {
  await page.goto('/image-factory?tab=vm-templates')
  await expect(page.getByRole('heading', { name: 'Proxmox VM-Templates' })).toBeVisible()
}

// ══════════════════════════════════════════════════════════════════════════════
// Sichtbarkeit / Edition / RBAC (AC-VIS-1 / AC-EDITION-1 / AC-RBAC-1)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-101 – Sichtbarkeit & Gating', () => {

  test('AC-VIS-1: Admin+Plus sieht „Replizieren" an QEMU-Template', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await goTab(page)
    await expect(page.getByRole('button', { name: /Replizieren/ })).toBeVisible()
  })

  test('AC-EDITION-1 (FE): ohne Capability keine „Replizieren"-Aktion', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin', { capReplicate: false })
    await goTab(page)
    await expect(page.getByText('deb12')).toBeVisible()
    await expect(page.getByRole('button', { name: /Replizieren/ })).toHaveCount(0)
  })

  test('QEMU-only: LXC-Template zeigt keine „Replizieren"-Aktion', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin', { templates: [LXC_TMPL] })
    await goTab(page)
    await expect(page.getByText('ct-base')).toBeVisible()
    await expect(page.getByRole('button', { name: /Replizieren/ })).toHaveCount(0)
  })

  test('AC-RBAC-1 (FE): Operator ohne Permission sieht keine Aktion', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await goTab(page)
    await expect(page.getByText('deb12')).toBeVisible()
    await expect(page.getByRole('button', { name: /Replizieren/ })).toHaveCount(0)
  })

  test('AC-RBAC-1 (FE): Operator mit replicate_templates sieht die Aktion', async ({ page }) => {
    await setToken(page, OPERATOR_PERM_TOKEN)
    await mockBaseApi(page, 'operator')
    await goTab(page)
    await expect(page.getByRole('button', { name: /Replizieren/ })).toBeVisible()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Modal-Flow (AC-FLOW / AC-STORAGE)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-101 – Replikations-Modal', () => {

  test('AC-FLOW-1: Modal zeigt Quell-Node + Quell-Template', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await mockPreflight(page, PREFLIGHT_LOCAL)
    await goTab(page)
    await page.getByRole('button', { name: /Replizieren/ }).click()
    await expect(page.getByText(/VMID 900 · pve1/)).toBeVisible()
  })

  test('AC-STORAGE-1: Quelle bereits shared → kein-Op-Banner, kein Start', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await mockPreflight(page, PREFLIGHT_SHARED_SOURCE)
    await goTab(page)
    await page.getByRole('button', { name: /Replizieren/ }).click()
    await expect(page.getByText(/bereits.*clusterweit|already.*cluster/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Replizieren starten|^Start replication/i })).toHaveCount(0)
  })

  test('N.4: Single-Node-Installation → Hinweis, kein Start', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await mockPreflight(page, PREFLIGHT_SINGLE_NODE)
    await goTab(page)
    await page.getByRole('button', { name: /Replizieren/ }).click()
    // Kein Ziel → Start-Button fehlt (nur „Schließen").
    await expect(page.getByRole('button', { name: /starten|Start replication/i })).toHaveCount(0)
  })

  test('AC-STORAGE-3: shared-Ziele kollabieren in Plan-Vorschau zu N→1', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await mockPreflight(page, PREFLIGHT_LOCAL)
    await goTab(page)
    await page.getByRole('button', { name: /Replizieren/ }).click()

    // „alle Nodes" + Default-Storage = ceph (shared, auf beiden Nodes) → 1 Op.
    await page.getByRole('radio', { name: /alle Nodes|all nodes/i }).check()
    await page.locator('#repl-default-storage').selectOption('ceph')
    // Plan-Vorschau: 2 Nodes kollabieren zu 1 Kopie (N→1).
    await expect(page.getByText(/2 Nodes → 1|2 nodes → 1/i)).toBeVisible()
  })

  test('AC-STORAGE-2 + AC-JOB-1: lokales Ziel → Start sendet Body + navigiert in Live-Log', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await mockPreflight(page, PREFLIGHT_LOCAL)

    let body = null
    await page.route(/\/api\/template-replication\/replicate/, (r) => {
      body = r.request().postDataJSON()
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(JOB) })
    })
    // Live-Log-Ziel nach dem Job unkritisch stubben.
    await page.route(/\/api\/jobs(\/|\?|$)/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JOB) }))

    await goTab(page)
    await page.getByRole('button', { name: /Replizieren/ }).click()
    await page.getByRole('radio', { name: /alle Nodes|all nodes/i }).check()
    await page.locator('#repl-default-storage').selectOption('local-lvm')
    await page.getByRole('button', { name: /starten|Start replication/i }).click()

    await expect.poll(() => body).not.toBeNull()
    expect(body).toMatchObject({ source_node: 'pve1', source_vmid: 900 })
    expect(body.targets.length).toBe(2)
    expect(body.targets.every(t => t.storage === 'local-lvm')).toBe(true)
    await page.waitForURL(/\/events\//)
  })

  test('AC-FLOW-5: Ziel-VMID pro Node ist im Standard-Modus setzbar (ohne Storage-Override)', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page, 'admin')
    await mockPreflight(page, PREFLIGHT_LOCAL)

    let body = null
    await page.route(/\/api\/template-replication\/replicate/, (r) => {
      body = r.request().postDataJSON()
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(JOB) })
    })
    await page.route(/\/api\/jobs(\/|\?|$)/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(JOB) }))

    await goTab(page)
    await page.getByRole('button', { name: /Replizieren/ }).click()
    await page.getByRole('radio', { name: /alle Nodes|all nodes/i }).check()
    await page.locator('#repl-default-storage').selectOption('local-lvm')

    // VMID-Sektion ist ohne „Storage pro Node abweichen" sichtbar; VMID nur für pve2 setzen.
    const vmidInputs = page.locator('input[type="number"]')
    await expect(vmidInputs).toHaveCount(2)
    await vmidInputs.first().fill('12345')

    await page.getByRole('button', { name: /starten|Start replication/i }).click()
    await expect.poll(() => body).not.toBeNull()
    const pve2 = body.targets.find(t => t.node === 'pve2')
    const pve3 = body.targets.find(t => t.node === 'pve3')
    expect(pve2.newid).toBe(12345)     // manuell gesetzt
    expect(pve3.newid).toBeUndefined() // leer → auto (Backend vergibt)
  })
})
