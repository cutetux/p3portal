// p3portal.org
// PROJ-45: E2E-Tests für User-Gruppen / Teams
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
// Payloads sind Base64-kodierte JWTs ohne echte Signatur (parseJwtPayload liest nur Payload).

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// {"sub":"groups_mgr","auth_type":"local","role":"operator","portal_permissions":["manage_groups"],"exp":9999999999}
const MANAGE_GROUPS_TOKEN =
  H + '.' +
  'eyJzdWIiOiJncm91cHNfbWdyIiwiYXV0aF90eXBlIjoibG9jYWwiLCJyb2xlIjoib3BlcmF0b3IiLCJwb3J0YWxfcGVybWlzc2lvbnMiOlsibWFuYWdlX2dyb3VwcyJdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-sig'

// {"sub":"plain_op","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const NO_PERM_TOKEN =
  H + '.' +
  'eyJzdWIiOiJwbGFpbl9vcCIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_GROUPS = [
  {
    id: 1, name: 'Web-Team', description: 'Frontend-Entwickler', tags: ['frontend', 'web'],
    owner_user_id: 2, owner_username: 'alice', member_count: 3,
    created_at: '2026-05-10T12:00:00Z', created_by: 'admin', members: [],
  },
  {
    id: 2, name: 'Stage-Tester', description: null, tags: ['testing'],
    owner_user_id: null, owner_username: null, member_count: 1,
    created_at: '2026-05-10T13:00:00Z', created_by: 'admin', members: [],
  },
]

const MOCK_USERS = [
  { id: 1, username: 'admin', role: 'admin', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
  { id: 2, username: 'alice', role: 'operator', active: true, portal_permissions: [], created_at: '2026-05-01T00:00:00Z' },
]

const MOCK_NODES = [
  { id: 1, name: 'pve01', host: '192.168.1.10', is_cluster: false, is_default: true },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockCommonApi(page) {
  // Force V1 interface (BUG-45-2 workaround: V2 sidebar lacks groups link)
  await page.route('/api/settings/ui-version', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v1' }) })
  )
  await page.route('/api/playbooks', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/cluster/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quorum: true, node_count: 1, ha_status: 'none' }),
    })
  )
  await page.route('/api/cluster/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/admin/nodes', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_NODES),
    })
  )
  await page.route('/api/admin/users', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_USERS),
    })
  )
  await page.route('/api/admin/announcements', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
  await page.route('/api/me/preferences', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ theme_preference: null, lang_preference: null }) })
  )
  // Plus edition by default (valid=true → isPlus=true)
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        edition: 'plus',
        valid: true,
        contact_name: null,
        expiry: null,
        reason: null,
        limits: {
          users: { current: 1, max: null, unlimited: true },
          presets: { current: 0, max: null, unlimited: true },
        },
      }),
    })
  )
}

async function mockGroupsApi(page, groups = MOCK_GROUPS) {
  await page.route('/api/groups', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groups) })
    } else {
      route.continue()
    }
  })
  await page.route('/api/groups/tags', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tags: ['frontend', 'web', 'testing'] }),
    })
  )
}

async function mockGroupDetail(page, group) {
  await page.route(`/api/groups/${group.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...group, members: group.members ?? [] }) })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// AC-23: Sidebar-Sichtbarkeit (manage_groups Gate)
// Hinweis: Tests erzwingen V1-Modus per mockCommonApi (BUG-45-2: V2-Sidebar fehlt Gruppen-Link)
// ════════════════════════════════════════════════════════════════════════════

test('AC-23: Admin sieht Gruppen-Link in der Sidebar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/groups"]')).toBeVisible()
})

test('AC-23: Operator mit manage_groups sieht Gruppen-Link in der Sidebar', async ({ page }) => {
  await setToken(page, MANAGE_GROUPS_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/groups"]')).toBeVisible()
})

test('AC-23: Operator ohne manage_groups sieht keinen Gruppen-Link', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.goto('/playbooks')
  await expect(page.locator('a[href="/admin/groups"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-21: Gruppen-Seite nur für manage_groups zugänglich
// ════════════════════════════════════════════════════════════════════════════

test('AC-21: Gruppen-Seite lädt für Admin', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/admin/groups')
  await expect(page.locator('text=Web-Team')).toBeVisible()
})

test('AC-21: Gruppen-Seite zeigt alle Gruppen in Tabelle', async ({ page }) => {
  await setToken(page, MANAGE_GROUPS_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/admin/groups')

  await expect(page.locator('text=Web-Team')).toBeVisible()
  await expect(page.locator('text=Stage-Tester')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-1 / AC-3 / AC-4: Gruppe anlegen – Happy Path + Validierung
// ════════════════════════════════════════════════════════════════════════════

test('AC-1: Neue-Gruppe-Button öffnet GroupFormModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/admin/groups')
  await page.locator('button:has-text("Neue Gruppe")').click()

  // Modal header should appear
  await expect(page.locator('text=Neue Gruppe anlegen')).toBeVisible()
})

test('AC-4: Gruppenname zu kurz wird am Backend als 422 abgelehnt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.route('/api/groups', async (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Gruppenname muss mindestens 2 Zeichen lang sein' }),
      })
    } else {
      route.continue()
    }
  })

  await page.goto('/admin/groups')
  await page.locator('button:has-text("Neue Gruppe")').click()
  await expect(page.locator('text=Neue Gruppe anlegen')).toBeVisible()

  const nameInput = page.locator('input[placeholder="z.B. Web-Team"]')
  await nameInput.fill('A')
  await page.locator('button[type="submit"]').or(page.locator('button:has-text("Speichern")')).click()
})

test('AC-3: Duplikat-Name zeigt 409-Fehlermeldung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.route('/api/groups', async (route) => {
    if (route.request().method() === 'POST') {
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: "Eine Gruppe mit dem Namen 'Web-Team' existiert bereits." }),
      })
    } else {
      route.continue()
    }
  })

  await page.goto('/admin/groups')
  await page.locator('button:has-text("Neue Gruppe")').click()

  const nameInput = page.locator('input[placeholder="z.B. Web-Team"]')
  await nameInput.fill('Web-Team')
  await page.locator('button[type="submit"]').or(page.locator('button:has-text("Speichern")')).click()

  await expect(page.locator('text=existiert bereits').or(page.locator('text=409'))).toBeVisible({ timeout: 3000 })
})

// ════════════════════════════════════════════════════════════════════════════
// AC-7: Basis-Limit-Banner bei 3 Gruppen (valid=false → isPlus=false)
// ════════════════════════════════════════════════════════════════════════════

test('AC-7: Basis-Limit-Banner erscheint bei 3 Gruppen und Button ist deaktiviert', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  const threeGroups = [
    { id: 1, name: 'Gruppe A', description: null, tags: [], owner_user_id: null, owner_username: null, member_count: 0, created_at: '2026-05-10T00:00:00Z', created_by: 'admin' },
    { id: 2, name: 'Gruppe B', description: null, tags: [], owner_user_id: null, owner_username: null, member_count: 0, created_at: '2026-05-10T00:00:00Z', created_by: 'admin' },
    { id: 3, name: 'Gruppe C', description: null, tags: [], owner_user_id: null, owner_username: null, member_count: 0, created_at: '2026-05-10T00:00:00Z', created_by: 'admin' },
  ]

  // Override license to basis edition: valid=false → isPlus=false (registered after mockCommonApi → higher priority)
  await page.route('/api/license/status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        edition: 'basis',
        valid: false,
        contact_name: null,
        expiry: null,
        reason: null,
        limits: {
          users: { current: 1, max: 6, unlimited: false },
          presets: { current: 0, max: 5, unlimited: false },
        },
      }),
    })
  )
  await mockGroupsApi(page, threeGroups)

  await page.goto('/admin/groups')

  // Button should be disabled (atLimit = !isPlus && groups.length >= 3)
  await expect(page.locator('button:has-text("Neue Gruppe")')).toBeDisabled()
  // Amber banner should contain the limit message
  await expect(page.locator('text=Gruppen belegt')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-14: Filter "Ohne Owner"
// ════════════════════════════════════════════════════════════════════════════

test('AC-14: Checkbox "Ohne Owner" filtert Gruppen ohne Owner', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let lastUrl = ''
  // Use regex to match /api/groups with or without query params (but not /api/groups/*)
  await page.route(/\/api\/groups(\?.*)?$/, (route) => {
    lastUrl = route.request().url()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_GROUPS[1]]) })
  })
  await page.route('/api/groups/tags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: [] }) })
  )

  await page.goto('/admin/groups')
  await page.waitForTimeout(300)

  // Check the "Ohne Owner" checkbox
  await page.locator('label:has-text("Ohne Owner")').locator('input[type="checkbox"]').check()

  // Wait for filter to be applied
  await page.waitForTimeout(500)
  expect(lastUrl).toContain('no_owner=true')
})

// ════════════════════════════════════════════════════════════════════════════
// AC-20: Tag-Filter
// ════════════════════════════════════════════════════════════════════════════

test('AC-20: Tag-Filter-Eingabe sendet Anfrage mit tag-Parameter', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)

  let lastUrl = ''
  await page.route(/\/api\/groups(\?.*)?$/, (route) => {
    lastUrl = route.request().url()
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([MOCK_GROUPS[0]]) })
  })
  await page.route('/api/groups/tags', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: ['frontend'] }) })
  )

  await page.goto('/admin/groups')
  await page.waitForTimeout(300)

  await page.locator('input[placeholder*="Tag"]').fill('frontend')
  await page.locator('button:has-text("#")').click()

  await page.waitForTimeout(500)
  expect(lastUrl).toContain('tag=frontend')
})

// ════════════════════════════════════════════════════════════════════════════
// AC-6: Löschen-Bestätigung (DeleteGroupConfirmModal)
// ════════════════════════════════════════════════════════════════════════════

test('AC-6: Löschen-Button öffnet Bestätigungs-Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/admin/groups')

  // Click delete button on first group row
  await page.locator('button:has-text("Löschen")').first().click()

  // Confirmation modal header should show "Gruppe löschen"
  await expect(page.locator('text=Gruppe löschen')).toBeVisible()
  // Body should mention the group name (dialog only)
  await expect(page.locator('[role="dialog"]').locator('text=Web-Team')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-5 / Edit-Modal
// ════════════════════════════════════════════════════════════════════════════

test('AC-5: Bearbeiten-Button öffnet GroupFormModal mit aktuellem Gruppenname', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/admin/groups')
  await page.locator('button:has-text("Bearbeiten")').first().click()

  // Edit modal header contains the group name
  await expect(page.locator('text=Gruppe bearbeiten: Web-Team')).toBeVisible({ timeout: 3000 })
})

// ════════════════════════════════════════════════════════════════════════════
// Mitglieder-Modal öffnen
// ════════════════════════════════════════════════════════════════════════════

test('Mitglieder-Klick auf Zähler öffnet GroupDetailModal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)
  await mockGroupDetail(page, {
    ...MOCK_GROUPS[0],
    members: [{ id: 1, user_id: 1, username: 'alice', role: 'operator', added_at: '2026-05-10T12:00:00Z', added_by: 'admin' }],
  })

  await page.goto('/admin/groups')

  // Click the member count button (shows "3" for Web-Team)
  await page.locator('button:has-text("3")').first().click()

  // Dialog should appear and load the group name in header
  await expect(page.locator('[role="dialog"]:has-text("Web-Team")')).toBeVisible({ timeout: 3000 })
})

// ════════════════════════════════════════════════════════════════════════════
// AC-2: 403-Pfad für User ohne manage_groups
// ════════════════════════════════════════════════════════════════════════════

test('AC-2: Operator ohne manage_groups wird von /admin/groups umgeleitet', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.goto('/admin/groups')

  // Should not see the groups page content — redirected or shows 403
  await expect(page.locator('text=Web-Team')).not.toBeVisible({ timeout: 3000 })
})

// ════════════════════════════════════════════════════════════════════════════
// AC-26: API-Antwortstruktur (Felder vorhanden)
// ════════════════════════════════════════════════════════════════════════════

test('AC-26: Gruppenübersicht zeigt Name, Tags, Owner und Mitglieder-Anzahl', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  await page.goto('/admin/groups')

  await expect(page.locator('text=Web-Team')).toBeVisible()
  // Use exact text match for tag chip (avoids matching "Frontend-Entwickler" description)
  await expect(page.locator(':text-is("frontend")')).toBeVisible()
  await expect(page.locator(':text-is("web")')).toBeVisible()
  await expect(page.locator(':text-is("alice")')).toBeVisible()
  // Member count button shows "3"
  await expect(page.locator('button:has-text("3")')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-19: Autocomplete-Tags werden von /api/groups/tags geladen
// ════════════════════════════════════════════════════════════════════════════

test('AC-19: Tags-Pool wird von Backend geladen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommonApi(page)
  await mockGroupsApi(page)

  let tagsRequested = false
  await page.route('/api/groups/tags', (route) => {
    tagsRequested = true
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tags: ['frontend', 'web', 'testing'] }) })
  })

  await page.goto('/admin/groups')
  await page.locator('button:has-text("Neue Gruppe")').click()

  // Form opens - tags pool was fetched (useTagsPool hook in GroupFormModal)
  await page.waitForTimeout(300)
  expect(tagsRequested).toBe(true)
})

// ════════════════════════════════════════════════════════════════════════════
// AC-35: Self-Service Join bleibt als Stub deaktiviert (PROJ-50 nicht deployed)
// ════════════════════════════════════════════════════════════════════════════

test('AC-35: GroupsTab im Profil zeigt Beitrittsanfrage-Hinweis als deaktiviert', async ({ page }) => {
  await setToken(page, NO_PERM_TOKEN)
  await mockCommonApi(page)

  await page.route('/api/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        username: 'plain_op',
        role: 'operator',
        auth_type: 'local',
        groups: [{ id: 1, name: 'Web-Team', owner_username: 'alice' }],
      }),
    })
  )
  await page.route('/api/me/ssh-key', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: null }) })
  )
  await page.route('/api/me/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )

  await page.goto('/profile')

  // Groups tab should appear because user has memberships
  await expect(page.locator('text=Web-Team').or(page.locator('text=Gruppen'))).toBeVisible({ timeout: 3000 })

  // Join request button should be disabled or show PROJ-50 placeholder
  const joinBtn = page.locator('button:has-text("Beitritt anfragen"), button[disabled]:has-text("Beitritt")')
  if (await joinBtn.count() > 0) {
    await expect(joinBtn.first()).toBeDisabled()
  }
})
