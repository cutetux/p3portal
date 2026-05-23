// p3portal.org
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ApiKeyCreateModal from './ApiKeyCreateModal'

vi.mock('../../api/userApiKeys', () => ({
  createMyApiKey: vi.fn(),
  getScopeManifest: vi.fn(),
}))

import { createMyApiKey, getScopeManifest } from '../../api/userApiKeys'

const MOCK_MANIFEST = {
  scopes: [
    { name: 'cluster:read',  description_key: 'scope.cluster_read.desc',  endpoints: [{ method: 'GET', path: '/api/cluster', summary_key: 'k' }], plus_only: false, curl_example: 'curl -H "Authorization: Bearer <KEY>" <HOST>/api/cluster' },
    { name: 'jobs:read',     description_key: 'scope.jobs_read.desc',     endpoints: [{ method: 'GET', path: '/api/jobs', summary_key: 'k' }], plus_only: false, curl_example: 'curl -H "Authorization: Bearer <KEY>" <HOST>/api/jobs' },
    { name: 'jobs:write',    description_key: 'scope.jobs_write.desc',    endpoints: [{ method: 'POST', path: '/api/jobs', summary_key: 'k' }], plus_only: false, curl_example: 'curl -X POST -H "Authorization: Bearer <KEY>" <HOST>/api/jobs' },
    { name: 'packer:read',   description_key: 'scope.packer_read.desc',   endpoints: [{ method: 'GET', path: '/api/packer/templates', summary_key: 'k' }], plus_only: false, curl_example: '' },
    { name: 'groups:write',  description_key: 'scope.groups_write.desc',  endpoints: [{ method: 'POST', path: '/api/groups', summary_key: 'k' }], plus_only: true, curl_example: '' },
  ],
  allowed_scopes: [],
}

const CREATED_KEY = {
  id: 1,
  name: 'GitLab CI',
  plaintext_key: 'upk_abc123def456xyz789longkeyvalue',
  key_prefix: 'upk_abc123de',
  scopes: ['jobs:write'],
  expires_at: '2027-05-03T10:00:00Z',
}

function mkClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderModal(props = {}) {
  getScopeManifest.mockResolvedValue(MOCK_MANIFEST)
  const onCreated = vi.fn()
  const onClose = vi.fn()
  const client = mkClient()
  render(
    <QueryClientProvider client={client}>
      <ApiKeyCreateModal onCreated={onCreated} onClose={onClose} {...props} />
    </QueryClientProvider>
  )
  return { onCreated, onClose }
}

describe('ApiKeyCreateModal – Rendering', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt RBAC-Hinweis im Modal-Header', async () => {
    renderModal()
    expect(screen.getByText(/pool-\/vm-\/node-\/playbook-beschränkungen/i)).toBeTruthy()
  })

  it('zeigt Scopes aus Manifest', async () => {
    renderModal()
    await waitFor(() => {
      expect(screen.getByText('cluster:read')).toBeTruthy()
      expect(screen.getByText('jobs:write')).toBeTruthy()
    })
  })

  it('zeigt alle Scope-Optionen nach Laden', async () => {
    renderModal()
    await waitFor(() => {
      expect(screen.getByText('packer:read')).toBeTruthy()
    })
  })

  it('deaktiviert Key-erstellen-Button wenn keine Scopes selektiert', async () => {
    renderModal()
    await waitFor(() => screen.getByText('cluster:read'))
    const btn = screen.getByRole('button', { name: /key erstellen/i })
    expect(btn).toBeDisabled()
  })
})

describe('ApiKeyCreateModal – Formularvalidierung', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt Fehler wenn Erstellen ohne Scope-Auswahl', async () => {
    renderModal()
    await waitFor(() => screen.getByPlaceholderText(/gitlab ci/i))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => {
      expect(screen.getByText(/mindestens einen scope/i)).toBeTruthy()
    })
  })

  it('kein API-Call wenn kein Scope gewählt', async () => {
    renderModal()
    await waitFor(() => screen.getByPlaceholderText(/gitlab ci/i))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => screen.getByText(/mindestens einen scope/i))
    expect(createMyApiKey).not.toHaveBeenCalled()
  })
})

describe('ApiKeyCreateModal – Erfolgreiche Erstellung', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt den Key im Klartext nach Erstellung', async () => {
    createMyApiKey.mockResolvedValue(CREATED_KEY)
    renderModal()
    await waitFor(() => screen.getByText('jobs:write'))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'GitLab CI' } })
    // Scope auswählen (Checkbox in der ScopeRow)
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[2]) // jobs:write
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => {
      expect(screen.getByDisplayValue(CREATED_KEY.plaintext_key)).toBeTruthy()
    })
  })

  it('zeigt upk_-Präfix im Klartext-Key', async () => {
    createMyApiKey.mockResolvedValue(CREATED_KEY)
    renderModal()
    await waitFor(() => screen.getByText('jobs:write'))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[2])
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => {
      const input = screen.getByDisplayValue(CREATED_KEY.plaintext_key)
      expect(input.value).toMatch(/^upk_/)
    })
  })

  it('zeigt Warn-Banner zur einmaligen Key-Anzeige', async () => {
    createMyApiKey.mockResolvedValue(CREATED_KEY)
    renderModal()
    await waitFor(() => screen.getByText('cluster:read'))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => {
      expect(screen.getByText(/kopiere den key jetzt/i)).toBeTruthy()
    })
  })

  it('ruft onCreated auf wenn Fertig geklickt', async () => {
    createMyApiKey.mockResolvedValue(CREATED_KEY)
    const { onCreated, onClose } = renderModal()
    await waitFor(() => screen.getByText('cluster:read'))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => screen.getByText(/kopiere den key jetzt/i))
    fireEvent.click(screen.getByRole('button', { name: /fertig/i }))
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ApiKeyCreateModal – Fehlerfall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt Fehlermeldung bei API-Fehler', async () => {
    createMyApiKey.mockRejectedValue({
      response: { data: { detail: 'Key-Limit erreicht.' } },
    })
    renderModal()
    await waitFor(() => screen.getByText('jobs:read'))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => {
      expect(screen.getByText('Key-Limit erreicht.')).toBeTruthy()
    })
  })

  it('zeigt generische Fehlermeldung bei unbekanntem Fehler', async () => {
    createMyApiKey.mockRejectedValue(new Error('Network'))
    renderModal()
    await waitFor(() => screen.getByText('cluster:read'))
    fireEvent.change(screen.getByPlaceholderText(/gitlab ci/i), { target: { value: 'Test' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.submit(screen.getByRole('button', { name: /key erstellen/i }).closest('form'))
    await waitFor(() => {
      expect(screen.getByText(/fehler beim erstellen/i)).toBeTruthy()
    })
  })
})

describe('ApiKeyCreateModal – Ablaufzeit-Auswahl', () => {
  it('zeigt alle Ablaufzeit-Optionen', async () => {
    renderModal()
    await waitFor(() => screen.getByText('cluster:read'))
    expect(screen.getByRole('option', { name: '30 Tage' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '90 Tage' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '180 Tage' })).toBeTruthy()
    expect(screen.getByRole('option', { name: /1 jahr/i })).toBeTruthy()
    expect(screen.getByRole('option', { name: /unbegrenzt/i })).toBeTruthy()
  })

  it('hat "1 Jahr" als Standardwert', async () => {
    renderModal()
    await waitFor(() => screen.getByText('cluster:read'))
    const select = screen.getByRole('combobox')
    expect(select.value).toBe('365')
  })
})
