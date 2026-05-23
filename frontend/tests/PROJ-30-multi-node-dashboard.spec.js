// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const NODE_PROD = {
  node: 'pve1', status: 'online', portal_node_name: 'Production',
  cpu: 0.3, maxcpu: 8, mem: 8589934592, maxmem: 34359738368,
  disk: 10737418240, maxdisk: 107374182400, uptime: 86400,
}

const NODE_STAGING = {
  node: 'pve2', status: 'online', portal_node_name: 'Staging',
  cpu: 0.1, maxcpu: 4, mem: 2147483648, maxmem: 8589934592,
  disk: 5368709120, maxdisk: 53687091200, uptime: 43200,
}

const NODE_SINGLE = {
  node: 'pve1', status: 'online',
  cpu: 0.2, maxcpu: 4, mem: 4294967296, maxmem: 8589934592,
  disk: 5368709120, maxdisk: 53687091200, uptime: 3600,
}

const VM_PROD = {
  vmid: 101, name: 'prod-web', type: 'qemu', status: 'running',
  node: 'pve1', portal_node_name: 'Production',
  cpu: 0.05, mem: 2147483648, maxmem: 4294967296, uptime: 3600, template: 0,
}

const VM_STAGING = {
  vmid: 101, name: 'staging-web', type: 'qemu', status: 'running',
  node: 'pve2', portal_node_name: 'Staging',
  cpu: 0.02, mem: 1073741824, maxmem: 2147483648, uptime: 1800, template: 0,
}

const VM_SINGLE = {
  vmid: 101, name: 'single-vm', type: 'qemu', status: 'running',
  node: 'pve1',
  cpu: 0.05, mem: 1073741824, maxmem: 2147483648, uptime: 3600, template: 0,
}

const STATUS_MULTI = {
  quorum: true, node_count: 2, ha_status: 'active', unreachable_nodes: [],
}

const STATUS_WITH_UNREACHABLE = {
  quorum: false, node_count: 1, ha_status: 'none', unreachable_nodes: ['Staging'],
}

const STATUS_SINGLE = {
  quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [],
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockBaseApi(page) {
  await page.route('**/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: 'admin', auth_type: 'local', role: 'admin',
      must_change_pw: false, last_login_at: null, last_login_ip: null,
    })}))
  await page.route('**/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ edition: 'plus', valid: true }) }))
  await page.route('**/api/themes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/admin/settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ proxmox_node: 'pve1' }) }))
  await page.route('**/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/announcements', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

async function mockCluster(page, { nodes = [], vms = [], status = STATUS_SINGLE }) {
  await page.route('**/api/cluster/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
  await page.route('**/api/cluster/vms', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vms) }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) }))
  await page.route('**/api/vms/**/ip', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: null }) }))
}

// ── Tests: NodeCard – portal_node_name Badge ──────────────────────────────────

test.describe('PROJ-30: NodeCard – portal_node_name Badge', () => {
  test('zeigt portal_node_name Badge wenn Feld gesetzt ist', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD, NODE_STAGING],
      vms: [],
      status: STATUS_MULTI,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Production').first()).toBeVisible()
    await expect(page.getByText('Staging').first()).toBeVisible()
  })

  test('zeigt keinen portal_node_name Badge bei Single-Node ohne Feld', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_SINGLE],
      vms: [],
      status: STATUS_SINGLE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // pve1 is visible (node name) but no portal_node_name badge
    await expect(page.getByText('pve1').first()).toBeVisible()
    await expect(page.getByText('Production')).not.toBeVisible()
    await expect(page.getByText('Staging')).not.toBeVisible()
  })

  test('Node-Name und portal_node_name Badge erscheinen gemeinsam', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD],
      vms: [],
      status: STATUS_SINGLE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('pve1').first()).toBeVisible()
    await expect(page.getByText('Production').first()).toBeVisible()
  })
})

// ── Tests: VmTable – Cluster-Spalte ──────────────────────────────────────────

test.describe('PROJ-30: VmTable – Cluster-Spalte', () => {
  test('zeigt Cluster-Spalte wenn VMs portal_node_name haben', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [],
      vms: [VM_PROD, VM_STAGING],
      status: STATUS_MULTI,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // "Cluster" column header should appear
    await expect(page.getByRole('columnheader', { name: /Cluster/i })).toBeVisible()
  })

  test('zeigt keine Cluster-Spalte wenn VMs kein portal_node_name haben', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [],
      vms: [VM_SINGLE],
      status: STATUS_SINGLE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('columnheader', { name: /Cluster/i })).not.toBeVisible()
  })

  test('VMs aus zwei Portal-Nodes zeigen portal_node_name Badge in der Tabelle', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [],
      vms: [VM_PROD, VM_STAGING],
      status: STATUS_MULTI,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Both VM names visible
    await expect(page.getByRole('cell', { name: 'prod-web', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'staging-web', exact: true })).toBeVisible()

    // Portal node name badges in cluster column
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(2)
  })

  test('VM-ID-Kollision: beide VMs (gleiche VMID, verschiedene Nodes) erscheinen', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    // Both VMs have vmid=101 but different portal_node_name
    await mockCluster(page, {
      nodes: [],
      vms: [VM_PROD, VM_STAGING],
      status: STATUS_MULTI,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Both VMs with vmid=101 should be visible (no dedup)
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(page.getByRole('cell', { name: 'prod-web', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'staging-web', exact: true })).toBeVisible()
  })
})

// ── Tests: ClusterHealthBanner – unreachable_nodes ────────────────────────────

test.describe('PROJ-30: ClusterHealthBanner – Nicht-erreichbare Portal-Nodes', () => {
  test('zeigt orange Warn-Banner bei nicht erreichbarer Portal-Node', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD],
      vms: [VM_PROD],
      status: STATUS_WITH_UNREACHABLE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Nicht erreichbar:/)).toBeVisible()
    await expect(page.getByText(/Staging/)).toBeVisible()
  })

  test('zeigt kein Warn-Banner wenn unreachable_nodes leer ist', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD, NODE_STAGING],
      vms: [VM_PROD, VM_STAGING],
      status: STATUS_MULTI,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Nicht erreichbar:/)).not.toBeVisible()
  })

  test('Warn-Banner kann dismissed werden', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD],
      vms: [VM_PROD],
      status: STATUS_WITH_UNREACHABLE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Nicht erreichbar:/)).toBeVisible()

    // Click dismiss on the unreachable banner (first Ausblenden button)
    const dismissBtns = page.getByRole('button', { name: 'Ausblenden' })
    await dismissBtns.first().click()

    await expect(page.getByText(/Nicht erreichbar:/)).not.toBeVisible()
  })

  test('Unreachable-Banner und Cluster-Banner können unabhängig dismissed werden', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    // Status: unreachable_nodes present + multi-node cluster (triggers cluster banner too)
    await mockCluster(page, {
      nodes: [],
      vms: [],
      status: {
        quorum: true, node_count: 3, ha_status: 'active', unreachable_nodes: ['DC-East'],
      },
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Both banners visible
    await expect(page.getByText(/Nicht erreichbar:/)).toBeVisible()
    await expect(page.getByText('Cluster OK · 3 Nodes · HA aktiv')).toBeVisible()

    // Dismiss only unreachable banner
    const dismissBtns = page.getByRole('button', { name: 'Ausblenden' })
    await dismissBtns.first().click()

    // Unreachable gone, cluster banner still visible
    await expect(page.getByText(/Nicht erreichbar:/)).not.toBeVisible()
    await expect(page.getByText('Cluster OK · 3 Nodes · HA aktiv')).toBeVisible()
  })

  test('Daten der erreichbaren Node werden trotz Ausfall einer anderen Node angezeigt', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD],        // only Production node available
      vms: [VM_PROD],            // only Production VMs available
      status: STATUS_WITH_UNREACHABLE, // Staging unreachable
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Production VM still visible
    await expect(page.getByRole('cell', { name: 'prod-web', exact: true })).toBeVisible()

    // Warning shown
    await expect(page.getByText(/Nicht erreichbar:/)).toBeVisible()
    await expect(page.getByText(/Staging/)).toBeVisible()
  })
})

// ── Tests: Cluster-Status-Aggregation ────────────────────────────────────────

test.describe('PROJ-30: Cluster-Status – Aggregation über alle Portal-Nodes', () => {
  test('Cluster-Banner zeigt aggregierten node_count aus mehreren Nodes', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [NODE_PROD, NODE_STAGING],
      vms: [],
      status: { quorum: true, node_count: 4, ha_status: 'active', unreachable_nodes: [] },
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Cluster banner shows aggregated node count (4 Nodes from 2 installations)
    await expect(page.getByText(/4 Nodes/)).toBeVisible()
  })

  test('quorum=false führt zu rotem Banner wenn eine Node unerreichbar', async ({ page }) => {
    await setToken(page, ADMIN_TOKEN)
    await mockBaseApi(page)
    await mockCluster(page, {
      nodes: [],
      vms: [],
      status: STATUS_WITH_UNREACHABLE,
    })

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Orange unreachable warning present
    await expect(page.getByText(/Nicht erreichbar:/)).toBeVisible()
  })
})

// ── Tests: Basis-Edition – unverändertes Verhalten ───────────────────────────

test.describe('PROJ-30: Basis-Edition – Single-Node-Pfad unverändert', () => {
  test('Basis-Edition: keine Cluster-Spalte und kein portal_node_name Badge', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await page.route('**/api/me', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        username: 'viewer', auth_type: 'local', role: 'viewer',
        must_change_pw: false, last_login_at: null, last_login_ip: null,
      })}))
    await page.route('**/api/license/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ edition: 'basis', valid: true }) }))
    await page.route('**/api/themes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/playbooks', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/admin/settings', r =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ proxmox_node: 'pve1' }) }))
    await page.route('**/api/admin/nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/admin/users', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
    await page.route('**/api/announcements', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    // Basis edition: single node, no portal_node_name
    await page.route('**/api/cluster/nodes', r =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([NODE_SINGLE]) }))
    await page.route('**/api/cluster/vms', r =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([VM_SINGLE]) }))
    await page.route('**/api/cluster/status', r =>
      r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] }) }))
    await page.route('**/api/vms/**/ip', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: null }) }))

    await page.goto('/dashboard')
    await page.waitForLoadState('networkidle')

    // Single node: no cluster column
    await expect(page.getByRole('columnheader', { name: /Cluster/i })).not.toBeVisible()
    // No portal_node_name badge
    await expect(page.getByText('Production')).not.toBeVisible()
    await expect(page.getByText('Staging')).not.toBeVisible()
    // Node still shows
    await expect(page.getByText('pve1').first()).toBeVisible()
  })
})
