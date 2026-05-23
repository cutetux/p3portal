// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999,"portal_permissions":["manage_api_keys","manage_users","manage_nodes","manage_settings"]}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5LCJwb3J0YWxfcGVybWlzc2lvbnMiOlsibWFuYWdlX2FwaV9rZXlzIiwibWFuYWdlX3VzZXJzIiwibWFuYWdlX25vZGVzIiwibWFuYWdlX3NldHRpbmdzIl19' +
  '.fake-signature'

// {"sub":"operator","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwiZXhwIjo5OTk5OTk5OTk5fQ' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const STATUS_DONE = { setup_required: false, has_admin: true, has_node: true }

const PLUS_LICENSE = {
  edition: 'plus', valid: true, contact_name: 'Test', contact_email: 'test@example.com', expiry: null, reason: null,
  limits: {
    users: { current: 1, max: 10, unlimited: true },
    presets: { current: 0, max: 10, unlimited: true },
    groups: { current: 0, max: null, unlimited: true },
    pools: { current: 0, max: null, unlimited: true },
    sidebar_pins: { current: 0, max: 10, unlimited: false },
  },
}
const CORE_LICENSE = {
  edition: 'core', valid: true, contact_name: null, contact_email: null, expiry: null, reason: null,
  limits: {
    users: { current: 1, max: 6, unlimited: false },
    presets: { current: 0, max: 5, unlimited: false },
    groups: { current: 0, max: 3, unlimited: false },
    pools: { current: 0, max: 0, unlimited: false },
    sidebar_pins: { current: 0, max: 5, unlimited: false },
  },
}

// Scope-Manifest (Subset für Tests – 7 der 15 Scopes)
const MOCK_SCOPE_MANIFEST = {
  scopes: [
    {
      name: 'cluster:read',
      description_key: 'scope.cluster_read.desc',
      endpoints: [
        { method: 'GET', path: '/api/cluster', summary_key: 'scope.cluster_read.ep.status' },
        { method: 'GET', path: '/api/cluster/nodes', summary_key: 'scope.cluster_read.ep.nodes' },
      ],
      plus_only: false,
      curl_example: 'curl -H "Authorization: Bearer <KEY>" <HOST>/api/cluster',
    },
    {
      name: 'jobs:write',
      description_key: 'scope.jobs_write.desc',
      endpoints: [
        { method: 'POST', path: '/api/jobs', summary_key: 'scope.jobs_write.ep.start' },
        { method: 'DELETE', path: '/api/jobs/{id}', summary_key: 'scope.jobs_write.ep.cancel' },
      ],
      plus_only: false,
      curl_example: 'curl -X POST -H "Authorization: Bearer <KEY>" <HOST>/api/jobs',
    },
    {
      name: 'playbooks:write',
      description_key: 'scope.playbooks_write.desc',
      endpoints: [
        { method: 'POST', path: '/api/playbooks/upload', summary_key: 'scope.playbooks_write.ep.upload' },
      ],
      plus_only: false,
      curl_example: 'curl -X POST -H "Authorization: Bearer <KEY>" <HOST>/api/playbooks/upload',
    },
    {
      name: 'groups:write',
      description_key: 'scope.groups_write.desc',
      endpoints: [
        { method: 'POST', path: '/api/groups', summary_key: 'scope.groups_write.ep.create' },
      ],
      plus_only: true,
      curl_example: 'curl -X POST -H "Authorization: Bearer <KEY>" <HOST>/api/groups',
    },
    {
      name: 'owners:read',
      description_key: 'scope.owners_read.desc',
      endpoints: [
        { method: 'GET', path: '/api/owners', summary_key: 'scope.owners_read.ep.list' },
        { method: 'GET', path: '/api/me/owners', summary_key: 'scope.owners_read.ep.me' },
      ],
      plus_only: false,
      curl_example: 'curl -H "Authorization: Bearer <KEY>" <HOST>/api/me/owners',
    },
    {
      name: 'approvals:read',
      description_key: 'scope.approvals_read.desc',
      endpoints: [
        { method: 'GET', path: '/api/approvals', summary_key: 'scope.approvals_read.ep.list' },
      ],
      plus_only: false,
      curl_example: 'curl -H "Authorization: Bearer <KEY>" <HOST>/api/approvals',
    },
    {
      name: 'approvals:approve',
      description_key: 'scope.approvals_approve.desc',
      endpoints: [
        { method: 'POST', path: '/api/approvals/{id}/approve', summary_key: 'scope.approvals_approve.ep.approve' },
        { method: 'POST', path: '/api/approvals/{id}/reject', summary_key: 'scope.approvals_approve.ep.reject' },
      ],
      plus_only: false,
      curl_example: 'curl -X POST -H "Authorization: Bearer <KEY>" <HOST>/api/approvals/APPROVAL_ID/approve',
    },
  ],
  // Nur cluster:read + jobs:write für diesen User freigeschaltet
  allowed_scopes: ['cluster:read', 'jobs:write'],
}

const MOCK_KEYS = [
  {
    id: 1,
    name: 'CI/CD Key',
    key_prefix: 'upk_abc1234',
    scopes: ['jobs:write', 'cluster:read'],
    expires_at: null,
    last_used_at: '2026-05-01T10:00:00Z',
    created_at: '2026-04-01T00:00:00Z',
    is_active: true,
  },
]

const CREATED_KEY_RESPONSE = {
  id: 2,
  name: 'Test Key',
  plaintext_key: 'upk_testnewkey12345abcdefghijklmnop',
  key_prefix: 'upk_testnewk',
  scopes: ['cluster:read'],
  expires_at: null,
  last_used_at: null,
  created_at: '2026-05-14T00:00:00Z',
  is_active: true,
}

const MOCK_EXTERNAL_CALLS = [
  {
    id: 1,
    api_key_id: 1,
    api_key_name: 'CI/CD Key',
    scope_used: 'jobs:write',
    auth_kind: 'upk',
    endpoint_class: 'api',
    method: 'POST',
    endpoint: '/api/jobs',
    status_code: 200,
    job_id: 'abc-123',
    playbook: 'vm-deploy',
    node: null,
    callback_url: 'https://ci.example.com/webhook',
    called_at: '2026-05-14T10:00:00Z',
    user_id: 1,
  },
  {
    id: 2,
    api_key_id: 1,
    api_key_name: 'CI/CD Key',
    scope_used: 'jobs:write',
    auth_kind: 'upk',
    endpoint_class: 'api',
    method: 'POST',
    endpoint: '/api/jobs',
    status_code: 403,
    job_id: null,
    playbook: null,
    node: null,
    callback_url: null,
    called_at: '2026-05-14T09:00:00Z',
    user_id: 1,
  },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => {
    sessionStorage.clear()
    sessionStorage.setItem('token', t)
  }, token)
}

async function mockCommon(page, role = 'operator') {
  await page.route('/api/setup/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS_DONE) }))
  await page.route('/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ username: role, auth_type: 'local', role, active: true }) }))
  await page.route('/api/cluster/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], vms: [] }) }))
  await page.route('/api/playbooks', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/auth/logout', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.route('/api/me/ssh-key', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: null }) }))
  await page.route('/api/me/sessions', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/me/sidebar-pins', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/scopes/manifest', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SCOPE_MANIFEST) }))
}

async function openApiKeyModal(page) {
  // Profil-Seite: Tab "API Keys" (muss aktiviert sein)
  await page.goto('/account')
  await page.click('button:has-text("API Keys")')
  // Neuer Key öffnen (Button-Text: "Neuer Key")
  await page.click('button:has-text("Neuer Key")')
}

// ════════════════════════════════════════════════════════════════════════════
// AC-25: RBAC-Hinweis im API-Key-Create-Modal
// ════════════════════════════════════════════════════════════════════════════

test('AC-25: API-Key-Modal zeigt RBAC-Hinweis im Header', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_KEYS) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  await expect(page.locator('text=Dieser Key kann nie mehr als dein Nutzer-Account')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24a: Scope-Manifest geladen und Scope-Namen angezeigt
// ════════════════════════════════════════════════════════════════════════════

test('AC-24a: Modal lädt Scope-Manifest und zeigt Scope-Namen an', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  await expect(page.locator('text=cluster:read')).toBeVisible()
  await expect(page.locator('text=jobs:write')).toBeVisible()
  await expect(page.locator('text=playbooks:write')).toBeVisible()
  await expect(page.locator('text=owners:read')).toBeVisible()
  await expect(page.locator('text=approvals:read')).toBeVisible()
  await expect(page.locator('text=approvals:approve')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24b: Nicht freigeschaltete Scopes sind disabled
// ════════════════════════════════════════════════════════════════════════════

test('AC-24b: Nicht in allowed_scopes enthaltene Scopes sind deaktiviert', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)

  // playbooks:write nicht in allowed_scopes → disabled
  const playbooksRow = page.locator('label').filter({ hasText: 'playbooks:write' }).first()
  await expect(playbooksRow.locator('input[type="checkbox"]')).toBeDisabled()

  // cluster:read ist in allowed_scopes → enabled
  const clusterRow = page.locator('label').filter({ hasText: 'cluster:read' }).first()
  await expect(clusterRow.locator('input[type="checkbox"]')).toBeEnabled()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24c: plus_only Scopes zeigen PlusBadge (SVG)
// ════════════════════════════════════════════════════════════════════════════

test('AC-24c: plus_only Scope groups:write zeigt PlusBadge', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORE_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  // groups:write is plus_only → PlusBadge visible near that scope name
  const groupsRow = page.locator('text=groups:write').locator('..').first()
  await expect(groupsRow.locator('svg')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24d: Expandierbare Endpoint-Liste pro Scope
// ════════════════════════════════════════════════════════════════════════════

test('AC-24d: Scope-Zeile zeigt Endpunkt-Anzahl (expandierbar)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  // cluster:read has 2 endpoints → "2 Endpunkte" text
  await expect(page.locator('text=2 Endpunkte').first()).toBeVisible()
  // Expand to see /api/cluster
  await page.click('text=2 Endpunkte')
  await expect(page.getByText('/api/cluster').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24e: curl-Snippet erscheint wenn Scope selektiert
// ════════════════════════════════════════════════════════════════════════════

test('AC-24e: curl-Snippet erscheint nach Scope-Auswahl', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  // cluster:read ist allowed → aktivierbar
  const clusterLabel = page.locator('label').filter({ hasText: 'cluster:read' }).first()
  await clusterLabel.click()
  // curl-Snippet erscheint
  await expect(page.locator('text=curl-Beispiel').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24f: Erstellen-Button disabled wenn kein Scope gewählt
// ════════════════════════════════════════════════════════════════════════════

test('AC-24f: Erstellen-Button disabled wenn kein Scope gewählt', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  await expect(page.locator('button[type="submit"]:has-text("Key erstellen")')).toBeDisabled()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-24g: Nach Erstellung erscheint plaintext_key
// ════════════════════════════════════════════════════════════════════════════

test('AC-24g: Nach Erstellung wird plaintext_key angezeigt', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else if (r.request().method() === 'POST') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CREATED_KEY_RESPONSE) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)

  // Name eingeben
  await page.fill('input[placeholder*="GitLab"]', 'Test Key')

  // cluster:read aktivieren
  const clusterLabel = page.locator('label').filter({ hasText: 'cluster:read' }).first()
  await clusterLabel.click()

  // Erstellen
  await page.click('button[type="submit"]')

  // plaintext_key in readOnly-Input sichtbar (text= matcht keine input-values)
  await expect(page.locator('input[aria-label="API-Key"]')).toBeVisible()
  await expect(page.locator('input[aria-label="API-Key"]')).toHaveValue('upk_testnewkey12345abcdefghijklmnop')
})

// ════════════════════════════════════════════════════════════════════════════
// AC-19a: Admin Integrationen-Tab zeigt API-Richtlinie
// ════════════════════════════════════════════════════════════════════════════

test('AC-19a: Admin Integrationen-Tab zeigt API-Richtlinie', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/role-presets', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/api-key-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: true, api_keys_allowed_scopes: null, api_keys_max_count: null }) }))
  await page.route('/api/admin/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/pools', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/system-settings?tab=integrations')
  await expect(page.locator('button:has-text("API-Richtlinie")')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-19b: Admin Audit-Log-Tab wechselbar und zeigt Einträge
// ════════════════════════════════════════════════════════════════════════════

test('AC-19b: Audit-Log-Tab sichtbar und zeigt upk-Einträge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/role-presets', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/api-key-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: true, api_keys_allowed_scopes: null, api_keys_max_count: null }) }))
  await page.route('/api/admin/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/pools', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/external-calls**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_EXTERNAL_CALLS) }))

  await page.goto('/system-settings?tab=integrations')

  // Auf Audit-Log-Tab wechseln
  await page.click('button:has-text("Audit-Log")')

  // CI/CD Key im Audit-Log sichtbar
  await expect(page.locator('text=CI/CD Key').first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-19c: auth_kind 'upk' Badge sichtbar im Audit-Log
// ════════════════════════════════════════════════════════════════════════════

test('AC-19c: Audit-Log zeigt upk auth_kind Badge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/role-presets', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/api-key-settings', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: true, api_keys_allowed_scopes: null, api_keys_max_count: null }) }))
  await page.route('/api/admin/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/pools', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/admin/external-calls**', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_EXTERNAL_CALLS) }))

  await page.goto('/system-settings?tab=integrations')
  await page.click('button:has-text("Audit-Log")')

  // upk Badge in der Auth-Spalte sichtbar (span in td, nicht das hidden <option>)
  await expect(page.locator('td span').filter({ hasText: 'upk' }).first()).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-23: Neue Scopes in UserForm Admin-Whitelist sichtbar
// ════════════════════════════════════════════════════════════════════════════

test('AC-23: UserForm zeigt neue Scopes playbooks:write, owners:read, approvals:*', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockCommon(page, 'admin')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/admin/users', r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{
        id: 1, username: 'operator', role: 'operator', auth_type: 'local', active: true,
        api_keys_enabled: true, api_keys_allowed_scopes: ['cluster:read'], api_keys_max_count: null, portal_permissions: [],
      }]) }))
  await page.route('/api/admin/role-presets', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // UserForm ruft /api/admin/users/{id}/api-key-settings ab (user-spezifisch)
  await page.route(/\/api\/admin\/users\/\d+\/api-key-settings/, r =>
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ api_keys_enabled: true, api_keys_allowed_scopes: ['cluster:read'], api_keys_max_count: null }) }))
  await page.route('/api/admin/groups', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('/api/pools', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // AssignmentSection ruft rbac/users/{id}/assignments ab
  await page.route(/\/api\/rbac\/users\/\d+\/assignments/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // Node-Zuweisungen
  await page.route(/\/api\/node-assignments\/users\/\d+/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

  await page.goto('/system-settings?tab=users')

  // Warten bis Tabelle geladen
  await page.waitForSelector('table tbody tr', { timeout: 5000 })

  // "Bearbeiten"-Button (nicht der erste Button in der Zeile → der ist "Logs")
  await page.locator('button:has-text("Bearbeiten")').first().click()

  // Warten bis Slide-Out-Panel mit UserForm sichtbar ist
  await page.waitForSelector('text=Nutzer bearbeiten', { timeout: 5000 })

  // Scope-Checkbox-Sektion laden – Scopes sind nach ApiKeySettings-Load sichtbar
  await page.waitForSelector('text=playbooks:write', { timeout: 8000 })

  // Neue Scopes sind in der Checkbox-Liste sichtbar
  await expect(page.locator('text=playbooks:write')).toBeVisible()
  await expect(page.locator('text=owners:read')).toBeVisible()
  await expect(page.locator('text=approvals:read')).toBeVisible()
  await expect(page.locator('text=approvals:approve')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// AC-4: Scope-Manifest enthält keine /api/v1/-Pfade
// ════════════════════════════════════════════════════════════════════════════

test('AC-4: Scope-Manifest enthält keine /api/v1/-Pfade', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockCommon(page, 'operator')
  await page.route('/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLUS_LICENSE) }))
  await page.route('/api/profile/api-keys', r => {
    if (r.request().method() === 'GET') {
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
    } else { r.continue() }
  })

  await openApiKeyModal(page)
  // Kein /api/v1/-Pfad in Modal
  await expect(page.locator('text=/api/v1/')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// Hinweis: Scope-Enforcement AC-1..3, Rate-Limiting AC-14..16,
// Audit-Events AC-17..22 sind durch Backend-pytest-Tests abgedeckt
// ════════════════════════════════════════════════════════════════════════════
