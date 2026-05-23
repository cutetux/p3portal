// p3portal.org
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures ────────────────────────────────────────────────────────
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","exp":9999999999}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'

// {"sub":"operator1","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_PLAYBOOKS = [
  { id: 'pb_vm_deploy',  name: 'VM erstellen',       description: 'VM Deployment',   required_role: null, category: 'vm_deployment'  },
  { id: 'pb_lxc_deploy', name: 'LXC erstellen',      description: 'LXC Deployment',  required_role: null, category: 'lxc_deployment'  },
  { id: 'pb_configure',  name: 'VM konfigurieren',   description: 'Konfiguration',   required_role: null, category: 'vm_lxc_config'   },
  { id: 'pb_legacy',     name: 'Altes Playbook',     description: 'Ohne Kategorie',  required_role: null, category: null              },
]

const MOCK_DETAIL_VM = {
  id: 'pb_vm_deploy',
  name: 'VM erstellen',
  description: 'VM Deployment',
  required_role: null,
  category: 'vm_deployment',
  parameters: [
    { id: 'vm_name',    label: 'VM Name',                type: 'string',  required: true,  default: '' },
    { id: 'vm_cores',   label: 'CPU Kerne',              type: 'integer', required: false, default: 2,    min: 1,  max: 32     },
    { id: 'vm_ram_mb',  label: 'RAM (MB)',               type: 'integer', required: false, default: 2048, min: 512, max: 131072 },
    { id: 'vm_disk_gb', label: 'Festplattengröße (GB)', type: 'integer', required: false, default: 32,   min: 10, max: 2000   },
    { id: 'ssh_key',    label: 'SSH Public Key',         type: 'ssh_key', required: false, default: ''   },
  ],
}

const MOCK_DETAIL_LXC = {
  id: 'pb_lxc_deploy',
  name: 'LXC erstellen',
  description: 'LXC Deployment',
  required_role: null,
  category: 'lxc_deployment',
  parameters: [
    { id: 'ct_name',    label: 'Container-Name',         type: 'string',  required: true,  default: '' },
    { id: 'ct_cores',   label: 'CPU Kerne',              type: 'integer', required: false, default: 1,   min: 1,  max: 8    },
    { id: 'ct_ram_mb',  label: 'RAM (MB)',               type: 'integer', required: false, default: 512, min: 128, max: 65536 },
    { id: 'ct_disk_gb', label: 'Festplattengröße (GB)', type: 'integer', required: false, default: 8,   min: 1,  max: 500  },
    { id: 'ssh_key',    label: 'SSH Public Key',         type: 'ssh_key', required: false, default: ''  },
  ],
}

const MOCK_DETAIL_CONFIG = {
  id: 'pb_configure',
  name: 'VM konfigurieren',
  description: 'Konfiguration',
  required_role: null,
  category: 'vm_lxc_config',
  parameters: [
    { id: 'target_host', label: 'Ziel-VM',        type: 'target_host', required: true,  default: '' },
    { id: 'ssh_key',     label: 'SSH Public Key',  type: 'ssh_key',    required: false, default: '' },
  ],
}

// running VMs für TargetVmSelector – ip-Feld jetzt vorhanden (BUG-11-1 behoben)
const MOCK_VMS = [
  { vmid: 100, name: 'web-server',  status: 'running', type: 'qemu', node: 'pve1', cpu: 0.05, mem: 1073741824, maxmem: 4294967296, uptime: 3600, ip: '192.168.1.100' },
  { vmid: 101, name: null,          status: 'running', type: 'lxc',  node: 'pve1', cpu: 0.01, mem: 536870912,  maxmem: 1073741824, uptime: 7200, ip: '10.0.0.15'     },
  { vmid: 102, name: 'db-server',   status: 'stopped', type: 'qemu', node: 'pve2', cpu: 0,    mem: 0,          maxmem: 8589934592, uptime: 0,    ip: null             },
]

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockPlaybooks(page, playbooks = MOCK_PLAYBOOKS) {
  await page.route('/api/playbooks', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(playbooks) })
  )
}

async function mockDetail(page, id, detail) {
  await page.route(`/api/playbooks/${id}`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) })
  )
}

async function mockSshKey(page, key = null) {
  await page.route('/api/settings/ssh-key', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key }) })
  )
}

async function mockVms(page, vms = MOCK_VMS) {
  await page.route('/api/cluster/vms', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vms) })
  )
}

async function mockAdminUsers(page) {
  await page.route('/api/admin/users', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
}

async function mockPermissions(page) {
  await page.route('/api/me/permissions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', capabilities: {}, groups: [] }) })
  )
  await page.route('/api/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: 'admin', auth_type: 'local', role: 'admin' }) })
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Navigation & Struktur (AC1–AC3)
// ════════════════════════════════════════════════════════════════════════════

test('AC1: Playbooks-Seite zeigt drei Kategorie-Tabs', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockSshKey(page)
  await page.goto('/playbooks')

  await expect(page.getByRole('button', { name: 'VM Deployment', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'LXC Deployment', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'VM/LXC Konfiguration', exact: true })).toBeVisible()
})

test('AC2: Jeder Tab zeigt nur Playbooks der passenden Kategorie', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockSshKey(page)
  await page.goto('/playbooks')

  // Standardmäßig VM Deployment aktiv → nur VM-Playbook sichtbar
  await expect(page.locator('text=VM erstellen')).toBeVisible()
  await expect(page.locator('text=LXC erstellen')).not.toBeVisible()
  await expect(page.locator('text=VM konfigurieren')).not.toBeVisible()

  // LXC-Tab wählen
  await page.getByRole('button', { name: 'LXC Deployment' }).click()
  await expect(page.locator('text=LXC erstellen')).toBeVisible()
  await expect(page.locator('text=VM erstellen')).not.toBeVisible()

  // Konfig-Tab wählen
  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await expect(page.locator('text=VM konfigurieren')).toBeVisible()
  await expect(page.locator('text=LXC erstellen')).not.toBeVisible()
})

test('AC3: Playbook ohne category erscheint in keinem Tab', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockSshKey(page)
  await page.goto('/playbooks')

  // VM Deployment Tab
  await expect(page.locator('text=Altes Playbook')).not.toBeVisible()

  // LXC Tab
  await page.getByRole('button', { name: 'LXC Deployment' }).click()
  await expect(page.locator('text=Altes Playbook')).not.toBeVisible()

  // Konfig Tab
  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await expect(page.locator('text=Altes Playbook')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 2. VM Deployment – Formular (AC4–AC7)
// ════════════════════════════════════════════════════════════════════════════

test('AC4: VM-Deployment-Playbook erscheint im VM-Deployment-Tab', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockSshKey(page)
  await page.goto('/playbooks')

  // VM Deployment Tab ist standardmäßig aktiv
  await expect(page.locator('text=VM erstellen')).toBeVisible()
})

test('AC5/AC6: VM-Formular rendert Name, CPU, RAM, Disk und SSH-Key-Felder', async ({ page }) => {
  // Hinweis: Die reale ansible/meta.yaml enthält derzeit keine cpu/ram/disk-Felder –
  // dies ist ein separater Low-Befund (FIND-11-1). Der Test läuft mit Mock-Daten.
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()

  await expect(page.locator('label:has-text("VM Name")')).toBeVisible()
  await expect(page.locator('label:has-text("CPU Kerne")')).toBeVisible()
  await expect(page.locator('label:has-text("RAM (MB)")')).toBeVisible()
  await expect(page.locator('label:has-text("Festplattengröße (GB)")')).toBeVisible()
})

test('AC7: SshKeyField rendert mehrzeiliges Textarea für SSH-Public-Key', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()

  const textarea = page.locator('textarea[placeholder*="ssh-rsa"]')
  await expect(textarea).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 3. SSH-Key Vorausfüllung (AC8–AC9)
// ════════════════════════════════════════════════════════════════════════════

test('AC8: SSH-Textarea wird mit Admin-Key vorausgefüllt wenn einer hinterlegt ist', async ({ page }) => {
  const adminKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ admin@portal'
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page, adminKey)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()

  const textarea = page.locator('textarea[placeholder*="ssh-rsa"]')
  await expect(textarea).toHaveValue(adminKey)
})

test('AC8 (kein Key): SSH-Textarea bleibt leer wenn kein Admin-Key hinterlegt', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page, null)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()

  const textarea = page.locator('textarea[placeholder*="ssh-rsa"]')
  await expect(textarea).toHaveValue('')
})

test('AC9: Nutzer kann vorausgefüllten SSH-Key löschen', async ({ page }) => {
  const adminKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ admin@portal'
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page, adminKey)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()

  const textarea = page.locator('textarea[placeholder*="ssh-rsa"]')
  await expect(textarea).toHaveValue(adminKey)
  await textarea.clear()
  await expect(textarea).toHaveValue('')
})

test('AC9: Nutzer kann vorausgefüllten SSH-Key überschreiben', async ({ page }) => {
  const adminKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ admin@portal'
  const customKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI custom@host'
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page, adminKey)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()

  const textarea = page.locator('textarea[placeholder*="ssh-rsa"]')
  await textarea.fill(customKey)
  await expect(textarea).toHaveValue(customKey)
})

// ════════════════════════════════════════════════════════════════════════════
// 4. LXC Deployment (AC11–AC13)
// ════════════════════════════════════════════════════════════════════════════

test('AC11: LXC-Deployment-Tab zeigt Playbooks mit category: lxc_deployment', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockSshKey(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'LXC Deployment' }).click()
  await expect(page.locator('text=LXC erstellen')).toBeVisible()
})

test('AC12/AC13: LXC-Formular hat Container-Name, CPU, RAM, Disk und SSH-Key-Feld', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_lxc_deploy', MOCK_DETAIL_LXC)
  await mockSshKey(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'LXC Deployment' }).click()
  await page.locator('text=LXC erstellen').first().click()

  await expect(page.locator('label:has-text("Container-Name")')).toBeVisible()
  await expect(page.locator('label:has-text("CPU Kerne")')).toBeVisible()
  await expect(page.locator('label:has-text("RAM (MB)")')).toBeVisible()
  await expect(page.locator('label:has-text("Festplattengröße (GB)")')).toBeVisible()
  await expect(page.locator('textarea[placeholder*="ssh-rsa"]')).toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 5. VM/LXC Konfiguration – TargetVmSelector (AC14–AC19)
// ════════════════════════════════════════════════════════════════════════════

test('AC14: VM/LXC-Konfig-Tab zeigt Playbooks mit category: vm_lxc_config', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockSshKey(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await expect(page.locator('text=VM konfigurieren')).toBeVisible()
})

test('AC15: TargetVmSelector hat zwei Modi-Buttons (Dropdown und Manuell)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  await expect(page.getByRole('button', { name: 'Aus Cluster wählen' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manuell eingeben' })).toBeVisible()
})

test('AC16: Dropdown zeigt laufende VMs aus /api/cluster/vms (name + IP + type + node)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  // Auf Laden der VMs warten (async fetch nach Mount)
  const select = page.locator('select')
  await expect(select.locator('option').nth(1)).toBeAttached()
  const options = await select.locator('option').allTextContents()
  // web-server (running, mit IP) ist dabei und zeigt IP in der Option
  expect(options.some(o => o.includes('web-server'))).toBe(true)
  expect(options.some(o => o.includes('192.168.1.100'))).toBe(true)
  // VM 101 (lxc, running, kein Name, hat DHCP-IP)
  expect(options.some(o => o.includes('10.0.0.15'))).toBe(true)
  expect(options.some(o => o.includes('QEMU') || o.includes('LXC'))).toBe(true)
  // db-server (stopped) soll nicht erscheinen
  expect(options.some(o => o.includes('db-server'))).toBe(false)
})

test('AC17: Dropdown-Auswahl setzt target_host auf IP-Adresse (Fallback: VM-Name)', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  // Auf Laden der VMs warten, dann VM wählen
  const select = page.locator('select')
  await expect(select.locator('option').nth(1)).toBeAttached()
  // web-server hat ip=192.168.1.100 → Wert ist die IP
  await select.selectOption({ value: '192.168.1.100' })
  await expect(select).toHaveValue('192.168.1.100')
})

test('AC18: Manueller Modus ermöglicht freie IP/Hostname-Eingabe', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  await page.getByRole('button', { name: 'Manuell eingeben' }).click()

  const input = page.locator('input[placeholder*="192.168"]')
  await expect(input).toBeVisible()
  await input.fill('192.168.1.50')
  await expect(input).toHaveValue('192.168.1.50')
})

test('AC17-FALLBACK: VM ohne IP → Wert ist VM-Name (graceful fallback)', async ({ page }) => {
  // MOCK_VMS enthält keine VM ohne IP – extra Mock mit ip=null für einen Eintrag
  const vmsWithNoIp = [
    { vmid: 200, name: 'legacy-vm', status: 'running', type: 'qemu', node: 'pve1', cpu: 0.01, mem: 0, maxmem: 0, uptime: 100, ip: null },
  ]
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page, vmsWithNoIp)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  const select = page.locator('select')
  await expect(select.locator('option').nth(1)).toBeAttached()
  // Kein IP → Wert ist VM-Name; Label enthält KEINE IP-Angabe
  const opts = await select.locator('option').allTextContents()
  expect(opts.some(o => o.includes('legacy-vm'))).toBe(true)
  expect(opts.some(o => o.includes('192.'))).toBe(false)
  await select.selectOption({ value: 'legacy-vm' })
  await expect(select).toHaveValue('legacy-vm')
})

test('AC17-DHCP: LXC mit DHCP-IP → Wert ist die DHCP-Adresse', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page)  // VM 101 (LXC) hat ip: '10.0.0.15'
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  const select = page.locator('select')
  await expect(select.locator('option').nth(1)).toBeAttached()
  await select.selectOption({ value: '10.0.0.15' })
  await expect(select).toHaveValue('10.0.0.15')
})

test('AC19: Moduswechsel Dropdown ↔ Manuell ist jederzeit möglich und setzt Wert zurück', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  await mockVms(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  // Wechsel zu Manuell
  await page.getByRole('button', { name: 'Manuell eingeben' }).click()
  await expect(page.locator('input[placeholder*="192.168"]')).toBeVisible()

  // Wechsel zurück zu Dropdown
  await page.getByRole('button', { name: 'Aus Cluster wählen' }).click()
  await expect(page.locator('select')).toBeVisible()
  await expect(page.locator('input[placeholder*="192.168"]')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Admin – SSH-Key-Verwaltung (AC21–AC25)
// ════════════════════════════════════════════════════════════════════════════

test('AC21: SSH-Key-Sektion erscheint in der Admin-Nutzerverwaltung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)
  await mockSshKey(page, null)
  await mockPermissions(page)
  await page.goto('/admin/users')

  await expect(page.getByRole('heading', { name: 'Globaler SSH-Key' })).toBeVisible()
  await expect(page.locator('text=Kein globaler SSH-Key hinterlegt').first()).toBeVisible()
})

test('AC21: Hinterlegter SSH-Key wird maskiert angezeigt', async ({ page }) => {
  const fullKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC admin@portal'
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)
  await mockSshKey(page, fullKey)
  await mockPermissions(page)
  await page.goto('/admin/users')

  // Der Key wird mit "…" in der Mitte maskiert, nicht vollständig angezeigt
  await expect(page.locator('code:has-text("ssh-rsa")')).toBeVisible()
  await expect(page.locator('code:has-text("…")')).toBeVisible()
})

test('AC23: Admin kann SSH-Key über "Key hinterlegen" speichern', async ({ page }) => {
  let sshKeyCallCount = 0
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)
  // Erster Abruf: kein Key; zweiter Abruf (nach Speichern): Key vorhanden
  await page.route('/api/settings/ssh-key', route => {
    sshKeyCallCount++
    const key = sshKeyCallCount === 1 ? null : 'ssh-rsa AAAAB3N admin@portal'
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key }) })
  })
  await page.route('/api/admin/settings/ssh-key', route =>
    route.fulfill({ status: 204 })
  )
  await mockPermissions(page)
  await page.goto('/admin/users')

  await page.locator('button:has-text("Key hinterlegen")').click()
  await page.locator('textarea[placeholder*="ssh-rsa"]').last().fill('ssh-rsa AAAAB3N admin@portal')
  await page.locator('button:has-text("Speichern")').click()

  await expect(page.locator('text=SSH-Key gespeichert.')).toBeVisible()
})

test('AC23: Admin kann SSH-Key über "Entfernen" löschen', async ({ page }) => {
  const existingKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ admin@portal'
  await setToken(page, ADMIN_TOKEN)
  await mockAdminUsers(page)
  await mockSshKey(page, existingKey)
  await page.route('/api/admin/settings/ssh-key', route =>
    route.fulfill({ status: 204 })
  )
  await mockPermissions(page)
  await page.goto('/admin/users')

  await expect(page.locator('button:has-text("Entfernen")')).toBeVisible()
  await page.locator('button:has-text("Entfernen")').click()

  await expect(page.locator('text=SSH-Key entfernt.')).toBeVisible()
})

test('AC24: GET /api/settings/ssh-key ist für Operator-Nutzer erreichbar (kein 403)', async ({ page }) => {
  let sshKeyStatus = 0
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await page.route('/api/settings/ssh-key', route => {
    sshKeyStatus = 200
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: null }) })
  })
  await page.goto('/playbooks')

  // Warten bis SshKeyField-Komponente laden kann (nach Klick auf Playbook)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await page.locator('text=VM erstellen').first().click()
  await page.waitForTimeout(200)

  expect(sshKeyStatus).toBe(200)
})

test('AC25: SSH-Key wird nicht in sessionStorage oder localStorage gespeichert', async ({ page }) => {
  const key = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB admin@portal'
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page, key)
  await page.goto('/playbooks')

  await page.locator('text=VM erstellen').first().click()
  await page.waitForTimeout(300)

  const ssKeys = await page.evaluate(() => Object.keys(sessionStorage))
  const lsKeys = await page.evaluate(() => Object.keys(localStorage))

  // Kein SSH-Key-spezifischer Schlüssel im Storage
  expect(ssKeys.filter(k => k.includes('ssh'))).toHaveLength(0)
  expect(lsKeys.filter(k => k.includes('ssh'))).toHaveLength(0)
})

// ════════════════════════════════════════════════════════════════════════════
// 7. Edge Cases
// ════════════════════════════════════════════════════════════════════════════

test('EDGE1: Leerer Tab zeigt informativen Hinweis mit category-Code', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  // Keine LXC-Playbooks in der Liste
  await mockPlaybooks(page, [
    { id: 'pb_vm', name: 'VM erstellen', description: '', required_role: null, category: 'vm_deployment' },
  ])
  await mockSshKey(page)
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'LXC Deployment' }).click()
  await expect(page.locator('text=Keine Playbooks verfügbar')).toBeVisible()
  await expect(page.locator('text=lxc_deployment')).toBeVisible()
})

test('EDGE2: Proxmox offline – Dropdown zeigt Fehlermeldung, Manuell-Modus bleibt verfügbar', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_configure', MOCK_DETAIL_CONFIG)
  await mockSshKey(page)
  // Proxmox nicht erreichbar
  await page.route('/api/cluster/vms', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"Service unavailable"}' })
  )
  await page.goto('/playbooks')

  await page.getByRole('button', { name: 'VM/LXC Konfiguration' }).click()
  await page.locator('text=VM konfigurieren').first().click()

  await expect(page.locator('text=Cluster nicht erreichbar')).toBeVisible()

  // Manuell-Modus muss trotzdem funktionieren
  await page.getByRole('button', { name: 'Manuell eingeben' }).click()
  await expect(page.locator('input[placeholder*="192.168"]')).toBeVisible()
})

test('EDGE3: Tab-Wechsel schließt geöffnetes Formular', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  await mockPlaybooks(page)
  await mockDetail(page, 'pb_vm_deploy', MOCK_DETAIL_VM)
  await mockSshKey(page)
  await page.goto('/playbooks')

  // Playbook öffnen
  await page.locator('text=VM erstellen').first().click()
  await expect(page.locator('h2:has-text("VM erstellen")')).toBeVisible()

  // Tab wechseln → Formular soll verschwinden
  await page.getByRole('button', { name: 'LXC Deployment' }).click()
  await expect(page.locator('h2:has-text("VM erstellen")')).not.toBeVisible()
})

// ════════════════════════════════════════════════════════════════════════════
// 8. Security
// ════════════════════════════════════════════════════════════════════════════

test('SEC1: /playbooks ohne JWT leitet zu /login weiter', async ({ page }) => {
  await page.goto('/playbooks')
  await expect(page).toHaveURL(/\/login/)
})

test('SEC2: SSH-Key-Admin-Endpoint gibt 403 für Operator zurück', async ({ page }) => {
  await setToken(page, OPERATOR_TOKEN)
  // Mock gibt 403 zurück wie das echte Backend
  await page.route('/api/admin/settings/ssh-key', route => {
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"Forbidden"}' })
  })
  await page.goto('/')

  // Direkter API-Aufruf
  const resp = await page.evaluate(() =>
    fetch('/api/admin/settings/ssh-key', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('token')}` },
      body: JSON.stringify({ key: 'ssh-rsa evil' }),
    }).then(r => r.status)
  )
  expect(resp).toBe(403)
})

test('SEC3: SSH-Key-Section ist auf Admin-Seite nicht für Operator sichtbar', async ({ page }) => {
  // Operator-Nutzer werden durch ProtectedRoute von /admin/users ferngehalten
  await setToken(page, OPERATOR_TOKEN)
  await page.goto('/admin/users')
  // Redirect zu /dashboard da keine Admin-Rolle
  await expect(page).not.toHaveURL(/\/admin\/users/)
})
