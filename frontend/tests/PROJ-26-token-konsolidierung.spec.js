// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT Tokens ────────────────────────────────────────────────────────────────
// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }

const BASIS_LICENSE = {
  edition: 'basis', valid: false, contact_name: null, contact_email: null,
  expiry: null, reason: 'missing',
  limits: { users: { current: 1, max: 6, unlimited: false }, presets: { current: 0, max: 5, unlimited: false } },
}

const PLUS_LICENSE = {
  edition: 'plus_v1', valid: true, contact_name: 'Test', contact_email: 'test@example.com',
  expiry: '2099-01-01', reason: null,
  limits: { users: { current: 1, max: null, unlimited: true }, presets: { current: 0, max: null, unlimited: true } },
}

const MOCK_NODE_STANDALONE = {
  id: 1,
  name: 'Heimserver',
  url: 'https://pve.example.com:8006',
  proxmox_node: 'pve',
  verify_ssl: true,
  viewer_token_id: 'viewer@pam!tok',
  operator_token_id: 'op@pam!tok',
  admin_token_id: 'admin@pam!tok',
  packer_token_id: 'packer@pam!tok',
  is_default: true,
  cluster_nodes: [],
  created_at: '2026-05-01T00:00:00Z',
  created_by: 'admin',
}

const MOCK_NODE_CLUSTER = {
  id: 1,
  name: 'Heimcluster',
  url: 'https://pve.example.com:8006',
  proxmox_node: 'node-a',
  verify_ssl: true,
  viewer_token_id: 'viewer@pam!tok',
  operator_token_id: 'op@pam!tok',
  admin_token_id: 'admin@pam!tok',
  packer_token_id: 'packer@pam!tok',
  is_default: true,
  cluster_nodes: ['node-b', 'node-c'],
  created_at: '2026-05-01T00:00:00Z',
  created_by: 'admin',
}

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setupAdmin(page) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function mockCommon(page) {
  await page.route('/api/me', r => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin', active: true }),
  }))
  await page.route('/api/playbooks', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
}

async function mockLicense(page, license) {
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(license) }))
}

async function mockNodes(page, nodes) {
  await page.route('/api/admin/nodes', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nodes) }))
}

async function goToNodesPage(page) {
  await page.goto('/')
  await page.waitForTimeout(300)
  await page.goto('/admin/nodes')
  await page.waitForTimeout(300)
}

// Exact-text helper to avoid matching "Node hinzufügen" as well
const clusterAddBtn = (page) => page.getByRole('button', { name: 'Hinzufügen', exact: true })

// ════════════════════════════════════════════════════════════════════════════
// 1. NodeTable – Cluster-Badge
// ════════════════════════════════════════════════════════════════════════════

test.describe('NodeTable – Cluster-Badge', () => {

  test('AC-1: Cluster-Badge "+N" wird angezeigt wenn cluster_nodes vorhanden', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_CLUSTER])

    await goToNodesPage(page)

    // Badge "+2" für node-b + node-c
    const badge = page.locator('text=+2')
    await expect(badge).toBeVisible()
  })

  test('AC-2: Cluster-Badge fehlt wenn cluster_nodes leer', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await goToNodesPage(page)

    // No "+N" badge present
    const badge = page.locator('text=+1').or(page.locator('text=+2'))
    await expect(badge).not.toBeVisible()
  })

  test('AC-3: Cluster-Badge Tooltip zeigt Nodenames', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_CLUSTER])

    await goToNodesPage(page)

    // Badge has title attribute with node names
    const badge = page.locator('[title*="node-b"]')
    await expect(badge).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 2. NodeFormModal – Cluster-Toggle (Neuer Node)
// ════════════════════════════════════════════════════════════════════════════

test.describe('NodeFormModal – Cluster-Toggle', () => {

  async function openAddModal(page) {
    await goToNodesPage(page)
    await page.getByRole('button', { name: 'Node hinzufügen' }).click()
    await page.waitForTimeout(200)
  }

  test('AC-4: Cluster-Toggle ist initial deaktiviert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    const toggle = page.locator('[role="switch"]')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('AC-5: Cluster-Toggle aktivieren zeigt Cluster-Nodes-Eingabe', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    // Initially no cluster node input
    await expect(page.locator('input[placeholder="node-b"]')).not.toBeVisible()

    // Activate cluster toggle
    await page.locator('[role="switch"]').click()
    await expect(page.locator('[role="switch"]')).toHaveAttribute('aria-checked', 'true')

    // Cluster nodes input now visible
    await expect(page.locator('input[placeholder="node-b"]')).toBeVisible()
  })

  test('AC-6: Cluster-Node hinzufügen via Button', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    // Activate cluster
    await page.locator('[role="switch"]').click()

    // Type a node name and click Hinzufügen
    await page.locator('input[placeholder="node-b"]').fill('node-b')
    await clusterAddBtn(page).click()

    // Tag should appear
    await expect(page.locator('text=node-b').first()).toBeVisible()
  })

  test('AC-7: Cluster-Node hinzufügen via Enter-Taste', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    await page.locator('[role="switch"]').click()
    await page.locator('input[placeholder="node-b"]').fill('node-c')
    await page.locator('input[placeholder="node-b"]').press('Enter')

    await expect(page.locator('text=node-c').first()).toBeVisible()
  })

  test('AC-8: Cluster-Node entfernen via X-Button', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    await page.locator('[role="switch"]').click()
    await page.locator('input[placeholder="node-b"]').fill('node-b')
    await clusterAddBtn(page).click()

    // Tag visible
    await expect(page.locator('text=node-b').first()).toBeVisible()

    // Click the X button to remove
    await page.locator('[aria-label="node-b entfernen"]').click()

    // Tag gone
    await expect(page.locator('[aria-label="node-b entfernen"]')).not.toBeVisible()
  })

  test('AC-9: Cluster-Toggle deaktivieren leert cluster_nodes', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    // Activate + add node
    await page.locator('[role="switch"]').click()
    await page.locator('input[placeholder="node-b"]').fill('node-b')
    await clusterAddBtn(page).click()
    await expect(page.locator('text=node-b').first()).toBeVisible()

    // Deactivate toggle → cluster_nodes section disappears
    await page.locator('[role="switch"]').click()
    await expect(page.locator('input[placeholder="node-b"]')).not.toBeVisible()
    await expect(page.locator('[aria-label="node-b entfernen"]')).not.toBeVisible()
  })

  test('AC-10: Validierung – primärer Node darf nicht in Cluster-Liste stehen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await openAddModal(page)

    // Fill primary node field
    await page.locator('input[placeholder="pve"]').first().fill('node-a')

    // Activate cluster and add the same node name
    await page.locator('[role="switch"]').click()
    await page.locator('input[placeholder="node-b"]').fill('node-a')
    await clusterAddBtn(page).click()

    // Fill required fields to trigger validation on submit
    await page.locator('input[placeholder="Heimcluster"]').fill('Test')
    await page.locator('input[placeholder="https://pve01.example.com:8006"]').fill('https://pve.example.com:8006')
    await page.locator('input[placeholder="user@pam!token"]').first().fill('viewer@pam!tok')
    // Fill remaining token IDs
    const tokenInputs = await page.locator('input[placeholder="user@pam!token"]').all()
    for (const input of tokenInputs) {
      await input.fill('role@pam!tok')
    }
    // Token secrets for new node
    const secretInputs = await page.locator('input[placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"]').all()
    for (const input of secretInputs) {
      await input.fill('secret-value-here')
    }

    // Submit
    await page.locator('button[type="submit"]').click()

    // Expect validation error mentioning the duplicate node
    await expect(page.locator('text=node-a').first()).toBeVisible()
    // The error message should mention the primary node
    const errMsg = page.locator('text="node-a" ist bereits der primäre PVE-Node')
    await expect(errMsg).toBeVisible()
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 3. NodeFormModal – Bearbeiten (Edit-Modus)
// ════════════════════════════════════════════════════════════════════════════

test.describe('NodeFormModal – Bearbeiten', () => {

  test('AC-11: Cluster-Nodes werden im Edit-Modus korrekt vorgeladen', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_CLUSTER])

    await goToNodesPage(page)

    // Click Bearbeiten
    await page.locator('button:has-text("Bearbeiten")').first().click()
    await page.waitForTimeout(200)

    // Toggle should be active (cluster_nodes not empty)
    const toggle = page.locator('[role="switch"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    // Both cluster nodes should be shown as tags
    await expect(page.locator('[aria-label="node-b entfernen"]')).toBeVisible()
    await expect(page.locator('[aria-label="node-c entfernen"]')).toBeVisible()
  })

  test('AC-12: Standalone-Node hat Cluster-Toggle deaktiviert im Edit-Modus', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await goToNodesPage(page)

    await page.locator('button:has-text("Bearbeiten")').first().click()
    await page.waitForTimeout(200)

    const toggle = page.locator('[role="switch"]')
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
  })

  test('AC-13: API-Payload enthält cluster_nodes beim Speichern', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    // Capture the PUT request
    let capturedPayload = null
    await page.route('/api/admin/nodes/1', async (route) => {
      if (route.request().method() === 'PUT') {
        capturedPayload = JSON.parse(route.request().postData())
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_NODE_STANDALONE, cluster_nodes: ['node-b'] }),
        })
      } else {
        await route.continue()
      }
    })

    await goToNodesPage(page)
    await page.locator('button:has-text("Bearbeiten")').first().click()
    await page.waitForTimeout(200)

    // Activate cluster and add node-b
    await page.locator('[role="switch"]').click()
    await page.locator('input[placeholder="node-b"]').fill('node-b')
    await clusterAddBtn(page).click()

    // Mock nodes refresh after save
    await page.route('/api/admin/nodes', r => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ ...MOCK_NODE_STANDALONE, cluster_nodes: ['node-b'] }]),
    }))

    // Save
    await page.locator('button[type="submit"]').click()
    await page.waitForTimeout(300)

    // Payload must contain cluster_nodes
    expect(capturedPayload).not.toBeNull()
    expect(capturedPayload.cluster_nodes).toEqual(['node-b'])
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 4. NodeFormModal – cluster_nodes Duplikat-Prüfung
// ════════════════════════════════════════════════════════════════════════════

test.describe('NodeFormModal – Duplikat-Prüfung', () => {

  test('AC-14: Doppelter Eintrag in cluster_nodes wird ignoriert', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, PLUS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await goToNodesPage(page)
    await page.getByRole('button', { name: 'Node hinzufügen' }).click()
    await page.waitForTimeout(200)

    await page.locator('[role="switch"]').click()
    await page.locator('input[placeholder="node-b"]').fill('node-b')
    await clusterAddBtn(page).click()

    // Try to add node-b again
    await page.locator('input[placeholder="node-b"]').fill('node-b')
    await clusterAddBtn(page).click()

    // Only one node-b tag should exist
    const tags = page.locator('[aria-label="node-b entfernen"]')
    await expect(tags).toHaveCount(1)
  })

})

// ════════════════════════════════════════════════════════════════════════════
// 5. Rückwärtskompatibilität – Basis-Edition
// ════════════════════════════════════════════════════════════════════════════

test.describe('Rückwärtskompatibilität – Basis-Edition', () => {

  test('AC-15: Basis-Edition zeigt Node-Tabelle mit Bearbeiten-Button (kein Cluster-Badge)', async ({ page }) => {
    await setupAdmin(page)
    await mockCommon(page)
    await mockLicense(page, BASIS_LICENSE)
    await mockNodes(page, [MOCK_NODE_STANDALONE])

    await goToNodesPage(page)

    // Nodes page renders node name
    await expect(page.locator('text=Heimserver')).toBeVisible()
    // No cluster badge
    await expect(page.locator('text=+1').or(page.locator('text=+2'))).not.toBeVisible()
    // Bearbeiten is available
    await expect(page.locator('button:has-text("Bearbeiten")')).toBeVisible()
  })

})
