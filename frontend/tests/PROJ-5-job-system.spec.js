// p3portal.org
import { test, expect } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ0ZXN0dXNlckBwYW0iLCJwcm94bW94X3VzZXIiOiJ0ZXN0dXNlckBwYW0iLCJleHAiOjk5OTk5OTk5OTl9.' +
  'fake-signature'

const MOCK_JOBS = [
  {
    id: 'job-001',
    type: 'ansible',
    playbook: 'pb_prox-new-vm',
    status: 'success',
    created_at: '2026-04-25T10:00:00Z',
    started_at: '2026-04-25T10:00:01Z',
    finished_at: '2026-04-25T10:01:30Z',
    username: 'testuser@pam',
    params: { vm_name: 'test-vm' },
  },
  {
    id: 'job-002',
    type: 'ansible',
    playbook: 'pb_update',
    status: 'running',
    created_at: '2026-04-25T11:00:00Z',
    started_at: '2026-04-25T11:00:01Z',
    finished_at: null,
    username: 'testuser@pam',
    params: {},
  },
]

async function setupJobsPage(page, jobs = MOCK_JOBS) {
  await page.evaluate((token) => sessionStorage.setItem('token', token), FAKE_TOKEN)

  await page.route('/api/jobs', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(jobs),
    })
  )
  await page.route('/api/jobs/job-001', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_JOBS[0]),
    })
  )
  await page.route('/api/jobs/job-002', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_JOBS[1]),
    })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ username: 'testuser@pam', capabilities: {}, groups: [] }),
    })
  )
}

// ── AC2+AC5: Job-Seite zeigt Job-Liste mit Status-Badges ─────────────────────

test('AC2+AC5: Job-Liste zeigt Jobs mit Playbook-Name, Zeitstempel und Status-Badge', async ({ page }) => {
  await page.goto('/jobs')
  await setupJobsPage(page)
  await page.goto('/jobs')

  // Playbook names
  await expect(page.locator('text=pb_prox-new-vm')).toBeVisible()
  await expect(page.locator('text=pb_update')).toBeVisible()

  // Status labels
  await expect(page.locator('text=Erfolgreich')).toBeVisible()
  await expect(page.locator('text=Läuft')).toBeVisible()
})

// ── AC6: Job-Historie zeigt Zeitstempel ───────────────────────────────────────

test('AC6: Job-Historie zeigt Zeitstempel und Job-ID', async ({ page }) => {
  await page.goto('/jobs')
  await setupJobsPage(page)
  await page.goto('/jobs')

  // Date formatted in German locale
  await expect(page.locator('text=/25\\.4\\.|25\\.04\\./').first()).toBeVisible()
  // Job ID is visible
  await expect(page.locator('text=#job-001')).toBeVisible()
})

// ── AC7: Laufende Jobs erkennbar (Spinner) ────────────────────────────────────

test('AC7: Laufende Jobs zeigen Spinner-Animation', async ({ page }) => {
  await page.goto('/jobs')
  await setupJobsPage(page)
  await page.goto('/jobs')

  // Running status shows animated spinner SVG via status badge
  const runningBadge = page.locator('text=Läuft')
  await expect(runningBadge).toBeVisible()

  // Click on running job to see its log panel with spinner
  await page.locator('text=pb_update').click()
  await expect(page.locator('.animate-spin')).toBeVisible()
})

// ── AC3+AC4: Log-Panel öffnet sich mit Live/Getrennt-Indikator ───────────────

test('AC3+AC4: Job-Log-Panel zeigt WebSocket-Verbindungsstatus', async ({ page }) => {
  await page.goto('/jobs')
  await setupJobsPage(page)
  await page.goto('/jobs/job-001')

  // Connection indicator is present (either Live or Getrennt)
  const indicator = page.locator('text=/Live|Getrennt/')
  await expect(indicator).toBeVisible()
})

// ── Empty state: No jobs shows placeholder ────────────────────────────────────

test('Empty state: Keine Jobs zeigt hilfreichen Hinweis', async ({ page }) => {
  await page.goto('/jobs')
  await page.evaluate((token) => sessionStorage.setItem('token', token), FAKE_TOKEN)
  await page.route('/api/jobs', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'testuser@pam', capabilities: {}, groups: [] }) })
  )
  await page.goto('/jobs')

  await expect(page.locator('text=Noch keine Jobs')).toBeVisible()
  await expect(page.locator('text=Starte ein Playbook')).toBeVisible()
})

// ── Navigation: Clicking job row navigates to /jobs/{id} ─────────────────────

test('Navigation: Klick auf Job-Zeile navigiert zu /jobs/{id}', async ({ page }) => {
  await page.goto('/jobs')
  await setupJobsPage(page)
  await page.goto('/jobs')

  await page.locator('text=pb_prox-new-vm').click()
  await expect(page).toHaveURL(/\/jobs\/job-001/)
})

// ── Refresh button reloads job list ──────────────────────────────────────────

test('Aktualisieren-Button lädt die Job-Liste neu', async ({ page }) => {
  await page.goto('/jobs')
  let requestCount = 0
  await page.evaluate((token) => sessionStorage.setItem('token', token), FAKE_TOKEN)
  await page.route('/api/jobs', (route) => {
    requestCount++
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_JOBS) })
  })
  await page.route('/api/me/permissions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'testuser@pam', capabilities: {}, groups: [] }) })
  )
  await page.goto('/jobs')

  const initialCount = requestCount
  await page.click('button:has-text("Aktualisieren")')
  await page.waitForTimeout(300)
  expect(requestCount).toBeGreaterThan(initialCount)
})

// ── Security: Unauthenticated access redirects to /login ─────────────────────

test('SEC: /jobs ohne JWT leitet zu /login weiter', async ({ page }) => {
  await page.goto('/jobs')
  await expect(page).toHaveURL(/\/login/)
})
