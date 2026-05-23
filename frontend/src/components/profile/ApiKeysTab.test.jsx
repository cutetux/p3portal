// p3portal.org
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import ApiKeysTab from './ApiKeysTab'

vi.mock('../../api/userApiKeys', () => ({
  listMyApiKeys: vi.fn(),
  revokeMyApiKey: vi.fn(),
}))

import { listMyApiKeys, revokeMyApiKey } from '../../api/userApiKeys'

const MOCK_KEYS = [
  {
    id: 1,
    name: 'GitLab CI',
    key_prefix: 'upk_abc1234',
    scopes: ['jobs:write', 'cluster:read'],
    expires_at: null,
    last_used_at: '2026-05-01T10:00:00Z',
    created_at: '2026-04-01T00:00:00Z',
    is_active: true,
  },
  {
    id: 2,
    name: 'Alter Key',
    key_prefix: 'upk_xyz9876',
    scopes: ['cluster:read'],
    expires_at: '2025-12-31T23:59:59Z',
    last_used_at: null,
    created_at: '2025-01-01T00:00:00Z',
    is_active: false,
  },
]

describe('ApiKeysTab – Ladestate', () => {
  it('zeigt Ladeanzeige während Fetch', () => {
    listMyApiKeys.mockReturnValue(new Promise(() => {}))
    render(<ApiKeysTab allowedScopes={null} maxKeys={1}/>)
    expect(screen.getByText(/lädt/i)).toBeTruthy()
  })
})

describe('ApiKeysTab – Leere Liste', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt Empty-State wenn keine Keys vorhanden', async () => {
    listMyApiKeys.mockResolvedValue([])
    render(<ApiKeysTab allowedScopes={null} maxKeys={1}/>)
    await waitFor(() => expect(screen.getByText(/noch keine api-keys/i)).toBeTruthy())
  })
})

describe('ApiKeysTab – Key-Liste', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt aktive und inaktive Keys an', async () => {
    listMyApiKeys.mockResolvedValue(MOCK_KEYS)
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => {
      expect(screen.getByText('GitLab CI')).toBeTruthy()
      expect(screen.getByText('Alter Key')).toBeTruthy()
    })
  })

  it('zeigt Key-Präfix mit Auslassungspunkten', async () => {
    listMyApiKeys.mockResolvedValue(MOCK_KEYS)
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => {
      expect(screen.getByText('upk_abc1234…')).toBeTruthy()
    })
  })

  it('zeigt Scopes als Tags', async () => {
    listMyApiKeys.mockResolvedValue(MOCK_KEYS)
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => {
      expect(screen.getByText('jobs:write')).toBeTruthy()
      expect(screen.getAllByText('cluster:read').length).toBeGreaterThan(0)
    })
  })

  it('zeigt Widerrufen-Badge für inaktive Keys', async () => {
    listMyApiKeys.mockResolvedValue(MOCK_KEYS)
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => {
      // Multiple "Widerrufen" texts expected: badge for inactive key + button for active key
      const all = screen.getAllByText('Widerrufen')
      expect(all.length).toBeGreaterThanOrEqual(1)
      // Badge is a <span>, button is a <button>
      const badge = all.find(el => el.tagName === 'SPAN')
      expect(badge).toBeTruthy()
    })
  })

  it('zeigt Widerrufen-Button nur für aktive Keys', async () => {
    listMyApiKeys.mockResolvedValue(MOCK_KEYS)
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => screen.getByText('GitLab CI'))
    // Only one active key → one revoke button
    const revokeButtons = screen.queryAllByRole('button', { name: /widerrufen/i })
    expect(revokeButtons.length).toBe(1)
  })
})

describe('ApiKeysTab – Limit-Guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deaktiviert Neuer-Key-Button wenn Limit erreicht', async () => {
    listMyApiKeys.mockResolvedValue([MOCK_KEYS[0]]) // 1 active key
    render(<ApiKeysTab allowedScopes={null} maxKeys={1}/>)
    await waitFor(() => screen.getByText('GitLab CI'))
    const btn = screen.getByRole('button', { name: /neuer key/i })
    expect(btn).toBeDisabled()
  })

  it('zeigt Zähler für aktive Keys', async () => {
    listMyApiKeys.mockResolvedValue([MOCK_KEYS[0]])
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => expect(screen.getByText(/1 \/ 5 aktive keys/i)).toBeTruthy())
  })
})

describe('ApiKeysTab – Widerrufen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('entfernt Key aus Liste nach Widerrufen', async () => {
    listMyApiKeys.mockResolvedValue([MOCK_KEYS[0]])
    revokeMyApiKey.mockResolvedValue(undefined)
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => screen.getByText('GitLab CI'))

    fireEvent.click(screen.getByRole('button', { name: /widerrufen/i }))
    await waitFor(() => {
      expect(revokeMyApiKey).toHaveBeenCalledWith(1)
      expect(screen.queryByText('GitLab CI')).toBeNull()
    })
  })

  it('zeigt Fehlermeldung bei Widerruf-Fehler', async () => {
    listMyApiKeys.mockResolvedValue([MOCK_KEYS[0]])
    revokeMyApiKey.mockRejectedValue(new Error('Network'))
    render(<ApiKeysTab allowedScopes={null} maxKeys={5}/>)
    await waitFor(() => screen.getByText('GitLab CI'))

    fireEvent.click(screen.getByRole('button', { name: /widerrufen/i }))
    await waitFor(() => {
      expect(screen.getByText(/fehler beim widerrufen/i)).toBeTruthy()
    })
  })
})
