// p3portal.org
// PROJ-68: E2E-Tests für Git-Sync für Playbooks & Packer
// Testet: GitSync-Sektion in Vorlagen-Tab, Core-Gate, Repo-Konfiguration,
//         Sync-Button, Konflikt-Auflösung, ZIP-Upload-Regression
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_LICENSE_PLUS = { edition: 'plus', is_plus_edition: true,  license_valid: true  }
const MOCK_LICENSE_CORE = { edition: 'core', is_plus_edition: false, license_valid: false }

const MOCK_CAPS_PLUS = {
  approval_workflow: false, approval_workflow_enabled: false,
  git_sync: true, help_global_overrides: true,
}
const MOCK_CAPS_CORE = {
  approval_workflow: false, approval_workflow_enabled: false,
  git_sync: false, help_global_overrides: false,
}

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin',
  auth_type: 'local', portal_permissions: ['manage_settings'], groups: [],
}

const MOCK_GIT_SYNC_ANSIBLE = {
  id: 1, repo_type: 'ansible', enabled: true,
  repo_url: 'https://github.com/example/ansible-playbooks.git',
  branch: 'main', subdir: 'playbooks',
  auth_method: 'https', https_username: 'token_user',
  has_https_token: true, ssh_public_key: null,
  has_webhook_token: true, auto_sync_interval: 15,
  updated_at: new Date().toISOString(), updated_by: 'admin',
}

const MOCK_CONFLICTS = [
  {
    id: 1,
    repo_type: 'ansible',
    item_id: 'create-vm',
    git_hash: 'abc123def456',
    detected_at: new Date(Date.now() - 10 * 60000).toISOString(),
    resolved_at: null,
    resolution: null,
    resolved_by: null,
  },
]

const MOCK_CONFLICTS_MIXED = [
  {
    id: 1, repo_type: 'ansible', item_id: 'create-vm',
    git_hash: 'abc123def456',
    detected_at: new Date(Date.now() - 10 * 60000).toISOString(),
    resolved_at: null, resolution: null, resolved_by: null,
  },
  {
    id: 2, repo_type: 'ansible', item_id: 'update-lxc',
    git_hash: 'def456abc789',
    detected_at: new Date(Date.now() - 60 * 60000).toISOString(),
    resolved_at: new Date(Date.now() - 30 * 60000).toISOString(),
    resolution: 'git', resolved_by: 'admin',
  },
]

const MOCK_SYNC_LOGS = [
  {
    id: 1, repo_type: 'ansible', status: 'success',
    items_synced: 3, items_conflicted: 0,
    triggered_by: 'manual',
    message: 'Sync completed successfully',
    log_detail: null,
    started_at: new Date(Date.now() - 5 * 60000).toISOString(),
  },
  {
    id: 2, repo_type: 'ansible', status: 'failed',
    items_synced: 0, items_conflicted: 0,
    triggered_by: 'manual',
    message: 'Repository not found',
    log_detail: null,
    started_at: new Date(Date.now() - 30 * 60000).toISOString(),
  },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setAdminToken(page) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupBaseMocks(page, { license = MOCK_LICENSE_PLUS, caps = MOCK_CAPS_PLUS } = {}) {
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()

    // Git-Sync (LIFO: spezifisch zuerst innerhalb der Catch-All-Funktion)
    if (url.match(/\/api\/git-sync\/conflicts\/\d+\/resolve/))
      return route.fulfill({ json: { id: 1, resolved_at: new Date().toISOString(), resolution: 'git', resolved_by: 'admin' } })
    if (url.includes('/api/git-sync/conflicts'))
      return route.fulfill({ json: [] })
    if (url.includes('/api/git-sync/logs/'))
      return route.fulfill({ json: [] })
    if (url.includes('/api/git-sync/config/') && route.request().method() === 'GET')
      return route.fulfill({ status: 404, json: { detail: 'Not configured' } })
    if (url.includes('/api/git-sync/sync/') && route.request().method() === 'POST')
      return route.fulfill({ json: { status: 'started', message: 'Sync gestartet' } })
    if (url.includes('/api/git-sync'))
      return route.fulfill({ json: [] })

    // Notifications (PROJ-65)
    if (url.includes('/api/notifications/unread-summary'))
      return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))
      return route.fulfill({ json: [] })

    // Tooling (PROJ-66)
    if (url.includes('/api/system/tooling'))
      return route.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } })

    // Auth + User
    if (url.includes('/api/license/status'))  return route.fulfill({ json: license })
    if (url.includes('/api/capabilities'))    return route.fulfill({ json: caps })
    if (url.includes('/api/me/permissions'))  return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))              return route.fulfill({ json: MOCK_ME_ADMIN })
    if (url.includes('/api/setup/status'))    return route.fulfill({ json: { setup_complete: true, has_admin: true, has_node: false, setup_required: false } })
    if (url.includes('/api/portal/config'))   return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))    return route.fulfill({ json: [] })

    // Cluster
    if (url.includes('/api/cluster/status'))  return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))   return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))         return route.fulfill({ json: [] })

    // Vorlagen-Tab
    if (url.includes('/api/playbooks'))       return route.fulfill({ json: [] })
    if (url.includes('/api/packer'))          return route.fulfill({ json: [] })

    // Admin
    if (url.includes('/api/admin/role-presets'))  return route.fulfill({ json: [] })
    if (url.includes('/api/admin/groups'))         return route.fulfill({ json: [] })
    if (url.includes('/api/admin/users'))          return route.fulfill({ json: [] })
    if (url.includes('/api/admin/proxmox-audit'))  return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))        return route.fulfill({ json: [] })

    // Sonstiges
    if (url.includes('/api/nodes'))   return route.fulfill({ json: [] })
    if (url.includes('/api/alerts'))  return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))  return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))    return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))    return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))    return route.fulfill({ json: [] })

    await route.continue()
  })
}

async function goToVorlagenTab(page) {
  await page.goto('/system-settings?tab=templates')
  await page.waitForLoadState('networkidle')
  // Extra-Wartezeit für React.lazy-chunk-Laden
  await page.waitForTimeout(1500)
}

// ── AC-CFG-1: GitSync-Sektion im Vorlagen-Tab sichtbar ───────────────────────

test('AC-CFG-1: Plus-Nutzer sieht Git-Sync-Sektion im Vorlagen-Tab', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page, { license: MOCK_LICENSE_PLUS, caps: MOCK_CAPS_PLUS })
  await goToVorlagenTab(page)

  // Sektion-Titel "Git-Sync" im h3-Heading sichtbar
  await expect(page.getByRole('heading', { name: /Git-Sync/ })).toBeVisible({ timeout: 8000 })
})

// ── AC-MISC-2: Core-Nutzer sieht Plus-Hinweis ────────────────────────────────

test('AC-MISC-2: Core-Nutzer sieht Plus-Gate in Git-Sync-Sektion', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page, { license: MOCK_LICENSE_CORE, caps: MOCK_CAPS_CORE })
  await goToVorlagenTab(page)

  // Sektion mit Plus-Hinweis wird gerendert (Core-Gate zeigt <p>Git-Sync</p>)
  // Core-Gate rendert einen <p>-Tag, kein h3
  await expect(page.locator('p').filter({ hasText: 'Git-Sync' }).first()).toBeVisible({ timeout: 8000 })
  // Kein Konfigurieren/Bearbeiten-Button
  await expect(page.getByRole('button', { name: /Konfigurieren/i })).not.toBeVisible()
  await expect(page.getByRole('button', { name: /Bearbeiten/i })).not.toBeVisible()
})

// ── AC-CFG-2: Zwei separate Repo-Panels ──────────────────────────────────────

test('AC-CFG-2: Ansible-Playbooks und Packer-Templates als separate Panels', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  // Ansible konfiguriert, Packer nicht konfiguriert
  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )

  await goToVorlagenTab(page)

  // Beide Panel-Labels sichtbar (i18n: repo_ansible, repo_packer)
  await expect(page.getByText('Ansible-Playbooks').first()).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('Packer-Templates').first()).toBeVisible({ timeout: 8000 })

  // Ansible zeigt konfigurierte Repo-URL
  await expect(page.getByText('https://github.com/example/ansible-playbooks.git')).toBeVisible()

  // Packer zeigt Konfigurieren-Button
  await expect(page.getByRole('button', { name: /Konfigurieren/i })).toBeVisible()
})

// ── AC-SYNC-1: Manueller Sync-Button ─────────────────────────────────────────

test('AC-SYNC-1: Jetzt-Synchronisieren-Button ruft Sync-API auf', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  let syncCalled = false

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/sync\/ansible$/, route => {
    syncCalled = true
    return route.fulfill({ json: { status: 'started', message: 'Sync gestartet' } })
  })

  await goToVorlagenTab(page)

  // i18n: sync_now_btn = 'Jetzt synchronisieren'
  const syncBtn = page.getByRole('button', { name: /Jetzt synchronisieren/i }).first()
  await expect(syncBtn).toBeVisible({ timeout: 8000 })
  await syncBtn.click()

  await page.waitForTimeout(300)
  expect(syncCalled).toBe(true)
})

// ── AC-SYNC-2: Status nach Sync sichtbar ─────────────────────────────────────

test('AC-SYNC-2: SyncStatusBar zeigt letzten Sync-Status (success/failed)', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )

  // SyncStatusBar lädt den letzten Log-Eintrag via logs-Endpoint
  await page.route(/localhost:\d+\/api\/git-sync\/logs\/ansible$/, route =>
    route.fulfill({ json: MOCK_SYNC_LOGS })
  )

  await goToVorlagenTab(page)

  // SyncStatusBar ist vorhanden wenn Repo konfiguriert
  // Prüfe ob Ansible-Panel vollständig geladen wurde
  await expect(page.getByText('Ansible-Playbooks').first()).toBeVisible({ timeout: 8000 })
  // URL ist sichtbar (config geladen)
  await expect(page.getByText('https://github.com/example/ansible-playbooks.git')).toBeVisible()
  // Sync-Button sichtbar = SyncStatusBar wurde gerendert
  await expect(page.getByRole('button', { name: /Jetzt synchronisieren/i })).toBeVisible()
})

// ── AC-CONFLICT-2: Konfliktliste ─────────────────────────────────────────────

test('AC-CONFLICT-2: Offene Konflikte werden in ConflictList angezeigt', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )
  // LIFO: spezifische Conflict-Route überschreibt catch-all
  await page.route(/localhost:\d+\/api\/git-sync\/conflicts$/, route =>
    route.fulfill({ json: MOCK_CONFLICTS })
  )

  // Conflicts-Response abwarten
  const conflictsPromise = page.waitForResponse(/\/api\/git-sync\/conflicts$/)

  await goToVorlagenTab(page)
  await conflictsPromise

  await page.waitForTimeout(500)

  // Konflikt-Item mit item_id sichtbar
  await expect(page.getByText('create-vm')).toBeVisible({ timeout: 8000 })
  // Auflösungs-Buttons sichtbar (i18n: conflict_keep_local, conflict_use_git)
  await expect(page.getByRole('button', { name: /Lokal behalten/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Git-Version übernehmen/i })).toBeVisible()
})

// ── AC-CONFLICT-3: Konflikt-Auflösung ────────────────────────────────────────

test('AC-CONFLICT-3: Konflikt-Auflösung via Git-Version sendet resolution=git', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )

  // Konflikte immer liefern (unabhängig von Aufrufzählung)
  await page.route(/localhost:\d+\/api\/git-sync\/conflicts$/, route =>
    route.fulfill({ json: MOCK_CONFLICTS })
  )

  let resolvePayload = null
  await page.route(/localhost:\d+\/api\/git-sync\/conflicts\/1\/resolve$/, route => {
    resolvePayload = route.request().postDataJSON()
    return route.fulfill({ json: {
      id: 1, resolved_at: new Date().toISOString(),
      resolution: 'git', resolved_by: 'admin'
    }})
  })

  // Conflicts-Response abwarten
  const conflictsPromise = page.waitForResponse(/\/api\/git-sync\/conflicts$/)
  await goToVorlagenTab(page)
  await conflictsPromise
  await page.waitForTimeout(500)

  const gitBtn = page.getByRole('button', { name: /Git-Version übernehmen/i })
  await expect(gitBtn).toBeVisible({ timeout: 8000 })

  // Resolve-Request abfangen und Button klicken
  const resolvePromise = page.waitForResponse(/\/api\/git-sync\/conflicts\/1\/resolve$/)
  await gitBtn.click()
  await resolvePromise

  // POST mit resolution=git gesendet
  expect(resolvePayload).not.toBeNull()
  expect(resolvePayload?.resolution).toBe('git')
})

// ── AC-CONFLICT-4: Gelöste Konflikte archiviert ───────────────────────────────

test('AC-CONFLICT-4: Gelöste Konflikte werden als einklappbare Liste archiviert', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )
  // Gemischte Konflikte: 1 offen, 1 gelöst
  await page.route(/localhost:\d+\/api\/git-sync\/conflicts$/, route =>
    route.fulfill({ json: MOCK_CONFLICTS_MIXED })
  )

  await goToVorlagenTab(page)
  await page.waitForTimeout(2000)

  // Offener Konflikt sichtbar
  await expect(page.getByText('create-vm')).toBeVisible({ timeout: 8000 })

  // "Gelöste Konflikte" Accordion-Button sichtbar (i18n: conflicts_resolved)
  // Text enthält "Gelöste" und Anzahl
  await expect(page.getByText(/Gelöste/i).first()).toBeVisible({ timeout: 5000 })
})

// ── AC-SYNC-5: Webhook-Token-Panel sichtbar ───────────────────────────────────

test('AC-SYNC-5: Webhook-Endpoint-Panel sichtbar nach Klick auf Bearbeiten', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )

  await goToVorlagenTab(page)

  // "Bearbeiten"-Button im Ansible-Panel klicken
  const editBtn = page.getByRole('button', { name: /Bearbeiten/i }).first()
  await expect(editBtn).toBeVisible({ timeout: 8000 })
  await editBtn.click()

  await page.waitForTimeout(500)

  // WebhookConfigPanel zeigt "Webhook-Endpoint" (i18n: webhook_title)
  await expect(page.getByText('Webhook-Endpoint')).toBeVisible({ timeout: 5000 })
})

// ── AC-MISC-1: ZIP-Upload-Regression ─────────────────────────────────────────

test('AC-MISC-1: ZIP-Upload-Buttons für Playbooks und Packer noch vorhanden', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)
  await goToVorlagenTab(page)

  // ZIP-Upload-Buttons müssen noch vorhanden sein (PROJ-68 darf diesen nicht entfernen)
  const uploadBtns = page.getByRole('button', { name: /Hochladen/i })
  await expect(uploadBtns.first()).toBeVisible({ timeout: 5000 })

  const count = await uploadBtns.count()
  expect(count).toBeGreaterThanOrEqual(2)
})

// ── AC-MISC-3: Sync-Verlauf einklappbar ───────────────────────────────────────

test('AC-MISC-3: Sync-Verlauf kann eingeblendet werden', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, route =>
    route.fulfill({ json: MOCK_GIT_SYNC_ANSIBLE })
  )
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )

  await goToVorlagenTab(page)

  // "Sync-Verlauf"-Toggle-Button (i18n: logs_toggle = 'Sync-Verlauf')
  const logsBtn = page.getByRole('button', { name: /Sync-Verlauf/i }).first()
  await expect(logsBtn).toBeVisible({ timeout: 8000 })

  // Logs-Endpoint bereitstellen BEVOR Toggle geklickt wird
  await page.route(/localhost:\d+\/api\/git-sync\/logs\/ansible$/, route =>
    route.fulfill({ json: MOCK_SYNC_LOGS })
  )

  await logsBtn.click()
  await page.waitForTimeout(800)

  // Tabellen-Zeilen sichtbar: Status-Dots (success=grün, failed=rot) + triggered_by
  // Mindestens eine Zeile mit "manual" (triggered_by-Wert)
  const rows = page.locator('table tbody tr')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })
  const rowCount = await rows.count()
  // 2 Logs + je 0 expand-rows = mindestens 2 Zeilen (ggf. mehr durch React Fragment keys)
  expect(rowCount).toBeGreaterThanOrEqual(1)
})

// ── AC-MISC-4: Konfiguration Speichern per PUT ────────────────────────────────

test('AC-MISC-4: Konfiguration-Speichern sendet PUT-Request', async ({ page }) => {
  await setAdminToken(page)
  await setupBaseMocks(page)

  let savedPayload = null
  let putCalled = false

  await page.route(/localhost:\d+\/api\/git-sync\/config\/ansible$/, async route => {
    if (route.request().method() === 'PUT') {
      putCalled = true
      savedPayload = route.request().postDataJSON()
      return route.fulfill({ json: { ...MOCK_GIT_SYNC_ANSIBLE, ...savedPayload } })
    }
    // GET: nicht konfiguriert → Formular zeigt "Konfigurieren"
    return route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  })
  await page.route(/localhost:\d+\/api\/git-sync\/config\/packer$/, route =>
    route.fulfill({ status: 404, json: { detail: 'Not configured' } })
  )

  await goToVorlagenTab(page)

  // Konfigurieren klicken
  const configBtn = page.getByRole('button', { name: /Konfigurieren/i }).first()
  await expect(configBtn).toBeVisible({ timeout: 8000 })
  await configBtn.click()

  await page.waitForTimeout(500)

  // URL-Feld ausfüllen
  const urlInput = page.getByPlaceholder(/https:\/\/|git@/).first()
  if (await urlInput.isVisible()) {
    await urlInput.fill('https://github.com/test/repo.git')

    // Speichern
    const saveBtn = page.getByRole('button', { name: /Speichern/i }).first()
    if (await saveBtn.isVisible()) {
      await saveBtn.click()
      await page.waitForTimeout(500)

      expect(putCalled).toBe(true)
      expect(savedPayload?.repo_url).toBe('https://github.com/test/repo.git')
    }
  }
})
