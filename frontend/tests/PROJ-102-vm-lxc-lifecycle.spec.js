// p3portal.org
// PROJ-102 — VM/LXC Clonen, Migrieren & zu Template konvertieren (Core)
// E2E gegen die „Lebenszyklus"-Aktionskarte der VM/LXC-Detailseite (PROJ-29):
// Clone-/Migrate-/Convert-Modal inkl. Zustands-/RBAC-/Stack-Gating + Job→Live-Log.
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures (Base64-Payload ohne echte Signatur, useAuth liest role) ──
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'
// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-VMs ─────────────────────────────────────────────────────────────────
const BASE_QEMU = {
  vmid: 100, name: 'web-server', type: 'qemu', node: 'pve1',
  ip: '192.168.1.100', uptime: 3661, tags: [], is_template: false,
  cpu_usage: 0.12, cpu_cores: 4, mem_used: 2147483648, mem_total: 8589934592,
  bios: 'seabios', ostype: 'l26', portal_node_id: 1, managed_by_stack: null,
  networks: [], disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G', serial: null }],
}
const VM_QEMU_STOPPED = { ...BASE_QEMU, status: 'stopped' }
const VM_QEMU_RUNNING = { ...BASE_QEMU, status: 'running' }
const VM_QEMU_TEMPLATE = { ...BASE_QEMU, status: 'stopped', is_template: true }
const VM_QEMU_STACK = {
  ...BASE_QEMU, status: 'stopped', name: 'stack-vm',
  managed_by_stack: { stack_id: 7, stack_name: 'web-stack' },
}
const VM_LXC_STOPPED = {
  vmid: 300, name: 'app-ct', type: 'lxc', status: 'stopped', node: 'pve1',
  ip: null, uptime: 0, tags: [], is_template: false,
  cpu_usage: null, cpu_cores: 2, mem_used: null, mem_total: 1073741824,
  bios: '', ostype: 'debian', portal_node_id: 1, managed_by_stack: null,
  lxc_hostname: 'app-ct', networks: [], disks: [{ id: 'rootfs', storage: 'local-lvm', size: '20G', serial: null }],
}

const IMAGE_STORAGES = [
  { name: 'local-lvm', type: 'lvmthin', avail: 50 * 1024 ** 3, total: 100 * 1024 ** 3, used: 50 * 1024 ** 3 },
  { name: 'ceph-pool', type: 'rbd', avail: 500 * 1024 ** 3, total: 1024 * 1024 ** 3, used: 0 },
]
const ROOTDIR_STORAGES = [
  { name: 'local', type: 'dir', avail: 40 * 1024 ** 3, total: 80 * 1024 ** 3, used: 40 * 1024 ** 3 },
]

// ── Helfer ────────────────────────────────────────────────────────────────────
async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockBaseApi(page, role) {
  await page.route('**/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: role, auth_type: 'local', role,
      must_change_pw: false, last_login_at: null, last_login_ip: null,
    }) }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ edition: 'plus', valid: true }) }))
  await page.route('**/api/themes', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/announcements', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/owners/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route(/\/api\/(cluster\/vms\/[^/]+\/[^/]+\/\d+|vms\/\d+)\/guest-info/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }))
  await page.route(/\/api\/vms\/\d+\/snapshots$/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route(/\/api\/cluster\/vms\/[^/]+\/[^/]+\/\d+\/backups/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ backups: [], schedules: [], storages: [] }) }))
  // Live-Log-Ziel nach dem Job (Navigation → /events/:id) unkritisch stubben.
  await page.route(/\/api\/jobs(\/|\?|$)/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      id: 'job-xyz', type: 'vm_clone', status: 'pending', playbook: 'clone:101',
      created_at: '2026-07-09T00:00:00Z', username: 'operator', params: {},
    }) }))
}

function mockVmDetail(page, detail) {
  return page.route(
    new RegExp(`/api/cluster/vms/${detail.node}/${detail.type}/${detail.vmid}$`),
    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }),
  )
}

function mockStorages(page) {
  page.route(/\/api\/nodes\/pve1\/image-storages/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IMAGE_STORAGES) }))
  page.route(/\/api\/nodes\/pve1\/rootdir-storages/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOTDIR_STORAGES) }))
}

function mockMigrationTargets(page, targets) {
  return page.route(/\/api\/vms\/\d+\/migration-targets/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ current_node: 'pve1', targets }) }))
}

async function goDetail(page, detail) {
  await page.goto(`/vm/${detail.node}/${detail.type}/${detail.vmid}`)
  await expect(page.getByRole('heading', { name: 'Lebenszyklus' })).toBeVisible()
}

const jobBody = { id: 'job-xyz', type: 'vm_clone', status: 'pending', playbook: 'clone:101',
  created_at: '2026-07-09T00:00:00Z', username: 'operator', params: {} }

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-1 / AC-STATE-1 / AC-STACK-1 (UI) — Aktionskarte + Zustands-/Stack-Gating
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-102 – Lebenszyklus-Karte & Gating', () => {

  test('AC-UI-1: gestoppte VM zeigt Klonen/Migrieren/Zu-Template aktiv', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    await goDetail(page, VM_QEMU_STOPPED)

    await expect(page.getByRole('button', { name: 'Klonen' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Migrieren' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Zu Template' })).toBeEnabled()
  })

  test('AC-STATE-1: laufende VM – Migrieren+Zu-Template deaktiviert, Klonen bleibt aktiv', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_RUNNING)
    await goDetail(page, VM_QEMU_RUNNING)

    await expect(page.getByRole('button', { name: 'Klonen' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Migrieren' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Zu Template' })).toBeDisabled()
  })

  test('AC-STACK-1 (UI): stack-verwaltet – Migrieren+Zu-Template deaktiviert, Klonen aktiv', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STACK)
    await goDetail(page, VM_QEMU_STACK)

    await expect(page.getByRole('button', { name: 'Klonen' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Migrieren' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Zu Template' })).toBeDisabled()
  })

  test('AC-TMPL-1: bereits-Template – Zu-Template deaktiviert', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_TEMPLATE)
    await goDetail(page, VM_QEMU_TEMPLATE)

    await expect(page.getByRole('button', { name: 'Zu Template' })).toBeDisabled()
  })

  test('AC-RBAC (UI): Viewer sieht keine Lebenszyklus-Karte', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page, 'viewer')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    await page.goto('/vm/pve1/qemu/100')
    await expect(page.getByText('web-server').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Lebenszyklus' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Klonen' })).toHaveCount(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Clone — AC-UI-4 / AC-CLONE-1..4
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-102 – Clone-Modal', () => {

  test('AC-CLONE-1/3/JOB-1: Full-Clone mit Owner sendet Body + navigiert in den Live-Log', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    mockStorages(page)

    let cloneBody = null
    await page.route(/\/api\/vms\/100\/clone(\?|$)/, (r) => {
      cloneBody = r.request().postDataJSON()
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(jobBody) })
    })

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Klonen' }).click()
    await expect(page.getByRole('heading', { name: /klonen/ })).toBeVisible()

    // Default: Name vorbelegt, Owner-Checkbox an, Full-Clone
    await expect(page.getByLabel('Mich als Owner der Kopie eintragen')).toBeChecked()
    const storageSelect = page.locator('#clone-storage')
    await expect(storageSelect.locator('option')).toHaveCount(3) // Standard + 2
    await page.locator('#clone-name').fill('web-server-copy')
    await page.locator('#clone-storage').selectOption('ceph-pool')

    await page.getByRole('button', { name: 'Klonen starten' }).click()
    await expect.poll(() => cloneBody).not.toBeNull()
    expect(cloneBody).toMatchObject({ name: 'web-server-copy', full: true, set_owner: true, target_storage: 'ceph-pool' })
    await page.waitForURL(/\/events\//)
  })

  test('AC-CLONE-3: Owner abwählbar → set_owner:false im Body', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    mockStorages(page)
    let cloneBody = null
    await page.route(/\/api\/vms\/100\/clone(\?|$)/, (r) => {
      cloneBody = r.request().postDataJSON()
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(jobBody) })
    })

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Klonen' }).click()
    await page.getByLabel('Mich als Owner der Kopie eintragen').uncheck()
    await page.getByRole('button', { name: 'Klonen starten' }).click()
    await expect.poll(() => cloneBody).not.toBeNull()
    expect(cloneBody.set_owner).toBe(false)
  })

  test('AC-CLONE-1: optionale VMID wird als newid übergeben', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    mockStorages(page)
    let cloneBody = null
    await page.route(/\/api\/vms\/100\/clone(\?|$)/, (r) => {
      cloneBody = r.request().postDataJSON()
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(jobBody) })
    })

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Klonen' }).click()
    await page.locator('#clone-vmid').fill('12345')
    await page.getByRole('button', { name: 'Klonen starten' }).click()
    await expect.poll(() => cloneBody).not.toBeNull()
    expect(cloneBody.newid).toBe(12345)
  })

  test('AC-CLONE-2: Nicht-Template → Linked-Clone deaktiviert + Hinweis', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    mockStorages(page)

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Klonen' }).click()
    const linked = page.getByRole('radio', { name: 'Linked-Clone' })
    await expect(linked).toBeDisabled()
    await expect(page.getByText('Linked-Clone ist nur von einem Template möglich.')).toBeVisible()
  })

  test('AC-CLONE-2: Template-Quelle → Linked-Clone wählbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_TEMPLATE)
    mockStorages(page)

    await goDetail(page, VM_QEMU_TEMPLATE)
    await page.getByRole('button', { name: 'Klonen' }).click()
    const linked = page.getByRole('radio', { name: 'Linked-Clone' })
    await expect(linked).toBeEnabled()
    await linked.check()
    // Linked-Clone blendet den Ziel-Storage aus (kein storage bei Linked).
    await expect(page.locator('#clone-storage')).toHaveCount(0)
  })

  test('AC-UI-3: LXC-Clone lädt rootdir-Storages statt image-Storages', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_LXC_STOPPED)
    let rootdirHit = false
    await page.route(/\/api\/nodes\/pve1\/rootdir-storages/, (r) => {
      rootdirHit = true
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROOTDIR_STORAGES) })
    })
    await page.route(/\/api\/nodes\/pve1\/image-storages/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IMAGE_STORAGES) }))

    await goDetail(page, VM_LXC_STOPPED)
    await page.getByRole('button', { name: 'Klonen' }).click()
    await expect(page.getByText('Hostname der Kopie')).toBeVisible()
    await expect.poll(() => rootdirHit).toBe(true)
    await expect(page.locator('#clone-storage')).toContainText('local')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Migrate — AC-MIG-1..4
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-102 – Migrate-Modal', () => {

  test('AC-MIG-1/4/JOB-1: Ziel-Node wählen → Body + Live-Log-Navigation', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    await mockMigrationTargets(page, ['pve2', 'pve3'])
    let migBody = null
    await page.route(/\/api\/vms\/100\/migrate(\?|$)/, (r) => {
      migBody = r.request().postDataJSON()
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ...jobBody, type: 'vm_migrate' }) })
    })

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Migrieren' }).click()
    const nodeSelect = page.locator('#mig-node')
    await expect(nodeSelect.locator('option')).toHaveCount(2)
    await nodeSelect.selectOption('pve3')
    await page.getByRole('button', { name: 'Migration starten' }).click()
    await expect.poll(() => migBody).not.toBeNull()
    expect(migBody.target_node).toBe('pve3')
    await page.waitForURL(/\/events\//)
  })

  test('AC-MIG-3: Single-Node – Hinweis + Submit deaktiviert', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    await mockMigrationTargets(page, [])

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Migrieren' }).click()
    await expect(page.getByText('Keine weiteren Cluster-Nodes verfügbar (Single-Node-Installation).')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Migration starten' })).toBeDisabled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// Convert-to-Template — AC-TMPL-2/4
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-102 – Convert-to-Template-Modal', () => {

  test('AC-TMPL-2/4: deutliche Sicherheitsabfrage inkl. Owner-Entfernung', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Zu Template' }).click()
    await expect(page.getByText('Achtung – nicht ohne Weiteres rückgängig')).toBeVisible()
    await expect(page.getByText(/Owner-Eintrag wird entfernt/)).toBeVisible()
  })

  test('AC-TMPL-3/JOB-1: Bestätigen sendet POST + navigiert in den Live-Log', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STOPPED)
    let converted = false
    await page.route(/\/api\/vms\/100\/convert-template(\?|$)/, (r) => {
      converted = true
      return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ ...jobBody, type: 'vm_template' }) })
    })

    await goDetail(page, VM_QEMU_STOPPED)
    await page.getByRole('button', { name: 'Zu Template' }).click()
    await page.getByRole('button', { name: 'Zu Template konvertieren' }).click()
    await expect.poll(() => converted).toBe(true)
    await page.waitForURL(/\/events\//)
  })
})
