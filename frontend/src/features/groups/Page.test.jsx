// p3portal.org
// PROJ-45: Vitest-Tests für GroupsPage, GroupFormModal, GroupsTab.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, opts) => {
    if (opts) {
      return Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), k)
    }
    return k
  }}),
}))

vi.mock('./hooks/useGroups', () => ({
  useGroups: vi.fn(),
  useTagsPool: vi.fn(() => []),
}))

vi.mock('../../hooks/useLicenseLimits', () => ({
  useLicenseLimits: vi.fn(),
}))

vi.mock('../../api/admin', () => ({
  fetchUsers: vi.fn(() => Promise.resolve([])),
}))

import GroupsPage from './Page'
import GroupsTab from './components/GroupsTab'
import { useGroups } from './hooks/useGroups'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'

const baseGroups = [
  {
    id: 1,
    name: 'Web-Team',
    description: 'Frontend-Entwickler',
    tags: ['frontend', 'web'],
    owner_username: 'admin',
    member_count: 3,
    created_at: '2026-05-11T00:00:00',
  },
]

function makeHook(overrides = {}) {
  return {
    groups: [],
    loading: false,
    error: '',
    filters: { search: '', no_owner: false, tag: '' },
    setFilters: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  }
}

function makeLicense(isPlus = true) {
  return { isPlus, userLimit: null, userAtLimit: false, appVersion: 'beta', reload: vi.fn() }
}

function wrap(ui) {
  return render(ui)
}

// ── GroupsPage ────────────────────────────────────────────────────────────────

describe('GroupsPage', () => {
  beforeEach(() => {
    useLicenseLimits.mockReturnValue(makeLicense())
  })

  it('shows loading state', () => {
    useGroups.mockReturnValue(makeHook({ loading: true }))
    wrap(<GroupsPage />)
    expect(screen.getByText('common.loading')).toBeTruthy()
  })

  it('shows error state', () => {
    useGroups.mockReturnValue(makeHook({ error: 'Ladefehler' }))
    wrap(<GroupsPage />)
    expect(screen.getByText('Ladefehler')).toBeTruthy()
  })

  it('shows empty state with create link', () => {
    useGroups.mockReturnValue(makeHook({ groups: [] }))
    wrap(<GroupsPage />)
    expect(screen.getByText('groups.empty')).toBeTruthy()
  })

  it('renders group rows', () => {
    useGroups.mockReturnValue(makeHook({ groups: baseGroups }))
    wrap(<GroupsPage />)
    expect(screen.getByText('Web-Team')).toBeTruthy()
    expect(screen.getByText('Frontend-Entwickler')).toBeTruthy()
    expect(screen.getByText('admin')).toBeTruthy()
  })

  it('shows tag chips in table', () => {
    useGroups.mockReturnValue(makeHook({ groups: baseGroups }))
    wrap(<GroupsPage />)
    expect(screen.getByText('frontend')).toBeTruthy()
    expect(screen.getByText('web')).toBeTruthy()
  })

  it('disables create button at core limit', () => {
    useLicenseLimits.mockReturnValue(makeLicense(false))
    const groups3 = [1, 2, 3].map(i => ({ ...baseGroups[0], id: i, name: `G${i}` }))
    useGroups.mockReturnValue(makeHook({ groups: groups3 }))
    wrap(<GroupsPage />)
    const btn = screen.getByText('groups.create_btn').closest('button')
    expect(btn.disabled).toBe(true)
  })

  it('shows limit banner at core limit', () => {
    useLicenseLimits.mockReturnValue(makeLicense(false))
    const groups3 = [1, 2, 3].map(i => ({ ...baseGroups[0], id: i, name: `G${i}` }))
    useGroups.mockReturnValue(makeHook({ groups: groups3 }))
    wrap(<GroupsPage />)
    // banner contains the key prefix
    expect(screen.getByText(/groups.limit_reached_banner/)).toBeTruthy()
  })

  it('opens create modal on button click (plus edition)', () => {
    useLicenseLimits.mockReturnValue(makeLicense(true))
    useGroups.mockReturnValue(makeHook({ groups: [] }))
    wrap(<GroupsPage />)
    fireEvent.click(screen.getByText('groups.create_btn'))
    expect(screen.getByText('groups.modal_create')).toBeTruthy()
  })

  it('no-owner filter checkbox toggles filter', () => {
    const setFilters = vi.fn()
    useGroups.mockReturnValue(makeHook({ groups: [], setFilters }))
    wrap(<GroupsPage />)
    const checkboxes = document.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes.length).toBeGreaterThan(0)
    fireEvent.click(checkboxes[0])
    expect(setFilters).toHaveBeenCalled()
  })
})

// ── GroupsTab (Profil) ────────────────────────────────────────────────────────

describe('GroupsTab', () => {
  it('shows empty state when no groups', () => {
    wrap(<GroupsTab groups={[]} />)
    expect(screen.getByText('groups.profile_empty')).toBeTruthy()
  })

  it('renders group list with name and owner', () => {
    const groups = [
      { id: 1, name: 'Web-Team', owner_username: 'alice' },
      { id: 2, name: 'Ops-Team', owner_username: null },
    ]
    wrap(<GroupsTab groups={groups} />)
    expect(screen.getByText('Web-Team')).toBeTruthy()
    expect(screen.getByText('Ops-Team')).toBeTruthy()
    expect(screen.getByText(/alice/)).toBeTruthy()
  })

  it('shows join request button as disabled', () => {
    const groups = [{ id: 1, name: 'A', owner_username: null }]
    wrap(<GroupsTab groups={groups} />)
    const btn = screen.getByText('groups.profile_join_request_disabled').closest('button')
    expect(btn.disabled).toBe(true)
  })
})
