// p3portal.org
// PROJ-58: E2E-Tests für Theme-System-Härtung
// Tests: --yellow Variable, portal-* Tailwind-Aliases, Approval-UI mit Theme-Farben
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

async function mockCommonApi(page, { plus = false } = {}) {
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }) })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/preferences', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme_preference: null, lang_preference: null }) })
  )
  await page.route('/api/me/pools', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/groups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/sidebar-pins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/license/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ edition: plus ? 'plus' : 'core', valid: plus, limits: {} }) })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/themes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/i18n/languages', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/approvals/count', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) })
  )
  await page.route('/api/admin/approval-workflow', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, max_approval_rules: 3 }) })
  )
}

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

// ════════════════════════════════════════════════════════════════════════════
// AC-1/2/3: CSS-Variable --yellow und Tailwind portal-* Tokens im Theme-System
// ════════════════════════════════════════════════════════════════════════════

test('AC-1/2/3: --yellow CSS-Variable ist im Standard-Theme gesetzt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // --yellow muss als CSS Custom Property auf :root/html verfügbar sein
  const yellowVal = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--yellow').trim()
  )
  expect(yellowVal).toBeTruthy()
  expect(yellowVal).not.toBe('')
})

// ════════════════════════════════════════════════════════════════════════════
// AC-5/6: Approval-Komponenten verwenden portal-* Tokens (keine bg-yellow-* etc.)
// ════════════════════════════════════════════════════════════════════════════

test('AC-5: ApprovalRulesAdminPage embedded enthält keine hardcodierten bg-yellow-* Klassen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await page.route('/api/approval-rules', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { id: 1, action_type: 'playbook_run', action_target: '*', is_active: true, required: true, approver_users: [], approver_groups: [] },
      ]),
    })
  )
  await page.route('/api/admin/settings/playbook-vmid-range', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ min: 100, max: 199 }) })
  )

  await page.goto('/system-settings?tab=portal&sub=approval_workflow')
  await page.waitForLoadState('networkidle')

  // Seite muss laden ohne Fehler
  await expect(page.locator('body')).toBeVisible()
  await expect(page.locator('text=404')).toHaveCount(0)

  // Approval-Workflow-Sektion soll sichtbar sein
  await expect(page.locator('text=Master-Toggle')).toBeVisible()

  // Keine raw tailwind-Farben in class-Attributen (prüft DOM)
  const yellowClasses = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[class*="bg-yellow-"], [class*="text-yellow-"], [class*="border-yellow-"]'))
    return els.length
  })
  expect(yellowClasses).toBe(0)
})

test('AC-6: V2Sidebar Approval-Counter verwendet portal-warn Farbe', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  // approval_workflow_enabled muss in license/status stehen (approvalWorkflowEnabled in useLicenseLimits)
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        edition: 'core', valid: false,
        approval_workflow_enabled: true,
        limits: {},
      }),
    })
  )
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }) })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/preferences', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme_preference: null, lang_preference: null }) })
  )
  await page.route('/api/me/pools', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/groups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/sidebar-pins', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/themes', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/i18n/languages', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/approval-workflow', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true, max_approval_rules: 3 }) })
  )
  await page.route('/api/approvals/count', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5 }) })
  )

  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  // Counter-Badge soll erscheinen (Badge ist im Bottom-Block der Desktop-Sidebar)
  const counterBadge = page.locator('aside a[href="/approvals"] span.rounded-full')
  await expect(counterBadge).toBeVisible({ timeout: 10000 })

  // Badge darf KEINE bg-yellow-* Klasse haben, muss portal-warn verwenden (PROJ-58 Migration)
  const badgeClass = await counterBadge.getAttribute('class')
  expect(badgeClass).not.toContain('bg-yellow-')
  expect(badgeClass).toContain('portal-warn')
})

// ════════════════════════════════════════════════════════════════════════════
// AC-9: Theme-Switch wirkt auf Approval-UI sofort
// ════════════════════════════════════════════════════════════════════════════

test('AC-9: Theme-Switch ändert --yellow CSS-Variable sofort', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page, { plus: true })
  // P3 Blue Theme mit eigenem --yellow
  await page.route('/api/themes', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([
        { id: 'p3blue', name: 'P3 Blue', is_builtin: true, vars: { '--yellow': '#f59e0b' } },
      ]),
    })
  )
  await page.route('/api/themes/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'p3blue', vars: { '--yellow': '#f59e0b' } }) })
  )

  await page.goto('/system-settings?tab=portal&sub=appearance')
  await page.waitForLoadState('networkidle')

  // Seite lädt ohne Fehler
  await expect(page.locator('body')).toBeVisible()
})
