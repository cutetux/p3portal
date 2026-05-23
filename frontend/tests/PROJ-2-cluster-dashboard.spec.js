// p3portal.org
import { test, expect } from '@playwright/test'

const FAKE_NODES = [
  {
    node: 'pve1', status: 'online',
    cpu: 0.12, maxcpu: 8,
    mem: 4294967296, maxmem: 17179869184,
    disk: 10737418240, maxdisk: 107374182400,
    uptime: 172800,
  },
]

const FAKE_VMS = [
  {
    vmid: 100, name: 'ubuntu-server', type: 'qemu',
    status: 'running', node: 'pve1',
    cpu: 0.05, maxcpu: 2,
    mem: 1073741824, maxmem: 2147483648,
    uptime: 3600,
  },
  {
    vmid: 101, name: 'db-server', type: 'qemu',
    status: 'stopped', node: 'pve1',
    cpu: 0.0, maxcpu: 4,
    mem: 0, maxmem: 4294967296,
    uptime: 0,
  },
]

const FAKE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

// Inject a fake JWT into sessionStorage so ProtectedRoute allows access
async function setFakeAuth(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('token', 'fake.jwt.token')
  })
}

// Route all three cluster API endpoints to return mock data
async function mockClusterApi(page) {
  // Use V1 sidebar so pre-PROJ-36 navigation/banner tests remain valid
  await page.route('/api/settings/ui-version', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v1"}' }))
  await page.route(/\/api\/cluster\/nodes/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) })
  )
  await page.route(/\/api\/cluster\/vms/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VMS) })
  )
  await page.route(/\/api\/cluster\/status/, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) })
  )
}

test.describe('PROJ-2 – Cluster-Dashboard', () => {

  test('AC1+AC2+AC4: Dashboard lädt automatisch nach Login und zeigt Node- und VM-Daten', async ({ page }) => {
    await setFakeAuth(page)
    await mockClusterApi(page)
    await page.goto('/dashboard')

    // Node "pve1" erscheint (mindestens einmal – in NodeCard und/oder VmTable)
    await expect(page.getByText('pve1').first()).toBeVisible()
    // VMs erscheinen
    await expect(page.getByText('ubuntu-server')).toBeVisible()
    await expect(page.getByText('db-server')).toBeVisible()
  })

  test('AC1: NodeCard zeigt Status, CPU-Auslastung und Node-Name', async ({ page }) => {
    await setFakeAuth(page)
    await mockClusterApi(page)
    await page.goto('/dashboard')

    await expect(page.getByText('pve1').first()).toBeVisible()
    // Online-Badge
    await expect(page.getByText('online')).toBeVisible()
    // Prozentzahl für CPU (cpu=0.12 → 12.0%)
    await expect(page.getByText(/12\.0%/)).toBeVisible()
  })

  test('AC2: VM-Tabelle zeigt Status running und stopped korrekt', async ({ page }) => {
    await setFakeAuth(page)
    await mockClusterApi(page)
    await page.goto('/dashboard')

    await expect(page.getByText('ubuntu-server')).toBeVisible()
    // Mindestens ein "running"-Badge
    await expect(page.getByText('running').first()).toBeVisible()
    // Mindestens ein "stopped"-Badge
    await expect(page.getByText('stopped').first()).toBeVisible()
  })

  test('AC3: ClusterStatusBar zeigt Cluster-Status bei Multi-Node', async ({ page }) => {
    await setFakeAuth(page)
    // Multi-node triggers cluster health display in PROJ-36 redesigned StatusBar
    const multiNodes = [
      { ...FAKE_NODES[0], node: 'pve1' },
      { ...FAKE_NODES[0], node: 'pve2' },
    ]
    await page.route('/api/settings/ui-version', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v1"}' }))
    await page.route(/\/api\/cluster\/nodes/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(multiNodes) })
    )
    await page.route(/\/api\/cluster\/vms/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VMS) })
    )
    await page.route(/\/api\/cluster\/status/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quorum: true, node_count: 2, ha_status: 'active' }) })
    )
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // Multi-node StatusBar zeigt "Cluster OK" wenn quorum+HA aktiv
    await expect(page.getByText('Cluster OK').first()).toBeVisible()
  })

  test('AC3: ClusterStatusBar zeigt "Kein Quorum" bei quorum=false', async ({ page }) => {
    await setFakeAuth(page)
    const multiNodes = [
      { ...FAKE_NODES[0], node: 'pve1' },
      { ...FAKE_NODES[0], node: 'pve2' },
    ]
    await page.route('/api/settings/ui-version', r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"v1"}' }))
    await page.route(/\/api\/cluster\/nodes/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(multiNodes) })
    )
    await page.route(/\/api\/cluster\/vms/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VMS) })
    )
    await page.route(/\/api\/cluster\/status/, route =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ quorum: false, node_count: 2, ha_status: 'none' }),
      })
    )
    await page.goto('/dashboard')
    await page.waitForTimeout(800)

    // StatusBar zeigt "Kein Quorum" wenn kein Quorum
    await expect(page.getByText('Kein Quorum').first()).toBeVisible()
  })

  test('AC6: Loading-State erscheint bevor Daten geladen sind', async ({ page }) => {
    await setFakeAuth(page)
    // Verzögerte API-Antwort simuliert langsames Laden
    await page.route(/\/api\/cluster\/nodes/, async route => {
      await new Promise(r => setTimeout(r, 300))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) })
    })
    await page.route(/\/api\/cluster\/vms/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VMS) })
    )
    await page.route(/\/api\/cluster\/status/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) })
    )

    await page.goto('/dashboard')
    // Skeleton oder Lade-Indikator sichtbar
    const skeleton = page.locator('.animate-pulse')
    await expect(skeleton.first()).toBeVisible()
  })

  test('AC7: Fehler-State erscheint wenn Proxmox API nicht erreichbar', async ({ page }) => {
    await setFakeAuth(page)
    await page.route(/\/api\/cluster\/nodes/, route =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ detail: 'Could not reach Proxmox API' }) })
    )
    await page.route(/\/api\/cluster\/vms/, route =>
      route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
    )
    await page.route(/\/api\/cluster\/status/, route =>
      route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
    )

    await page.goto('/dashboard')
    await expect(page.getByText(/verbindungsfehler/i)).toBeVisible()
  })

  test('AC8: Ohne JWT-Token wird auf Login weitergeleitet (/nodes schlägt fehl)', async ({ page }) => {
    // Kein sessionStorage-Token gesetzt
    await page.goto('/dashboard')
    // ProtectedRoute leitet auf /login weiter
    await expect(page).toHaveURL(/\/login/)
  })

  test('AC5+Manuell-Refresh: Refresh-Button löst erneutes Laden aus', async ({ page }) => {
    await setFakeAuth(page)
    let callCount = 0
    await page.route(/\/api\/cluster\/nodes/, route => {
      callCount++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_NODES) })
    })
    await page.route(/\/api\/cluster\/vms/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_VMS) })
    )
    await page.route(/\/api\/cluster\/status/, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_STATUS) })
    )

    await page.goto('/dashboard')
    await expect(page.getByText('pve1').first()).toBeVisible()
    const countAfterLoad = callCount

    // Manueller Refresh
    await page.getByRole('button', { name: /aktualisieren/i }).click()
    await page.waitForResponse(/\/api\/cluster\/nodes/)

    expect(callCount).toBeGreaterThan(countAfterLoad)
  })

})
