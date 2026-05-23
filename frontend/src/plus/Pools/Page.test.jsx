// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Tests für PoolsPage (Sidebar-Gate, Quota-Validierung, Plus-only).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import PoolsPage from './Page'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./hooks/usePools', () => ({
  usePools: vi.fn(),
  useTagsPool: () => [],
}))

vi.mock('../../hooks/useLicenseLimits', () => ({
  useLicenseLimits: vi.fn(),
}))

vi.mock('../../api/admin', () => ({
  fetchUsers: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: [] })) },
}))

import { usePools } from './hooks/usePools'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <PoolsPage />
      </I18nextProvider>
    </MemoryRouter>
  )
}

describe('PoolsPage', () => {
  beforeEach(() => {
    usePools.mockReturnValue({
      pools: [],
      loading: false,
      error: '',
      filters: { search: '', no_owner: false, tag: '' },
      setFilters: vi.fn(),
      reload: vi.fn(),
    })
    useLicenseLimits.mockReturnValue({ isPlus: true, userLimit: { unlimited: true } })
  })

  it('renders page header', () => {
    renderPage()
    expect(screen.getByRole('heading')).toBeInTheDocument()
  })

  it('shows create button when Plus active', () => {
    renderPage()
    const btn = screen.getByRole('button', { name: /neu/i })
    expect(btn).not.toBeDisabled()
  })

  it('disables create button when Core edition (isPlus=false)', () => {
    useLicenseLimits.mockReturnValue({ isPlus: false, userLimit: { unlimited: false } })
    renderPage()
    const btn = screen.getByRole('button', { name: /neu/i })
    expect(btn).toBeDisabled()
  })

  it('shows empty state when no pools', () => {
    renderPage()
    expect(screen.getByText(/keine.*pool/i)).toBeInTheDocument()
  })

  it('renders pool list when pools present', () => {
    usePools.mockReturnValue({
      pools: [
        {
          id: 1, name: 'Web-Team', description: null, tags: ['prod'],
          vm_count_quota: 10, cpu_quota: 0, ram_quota_mb: 0, disk_quota_gb: 0,
          member_count: 3, assignment_count: 1,
          created_at: '2026-05-12T00:00:00', created_by: 'admin',
        },
      ],
      loading: false,
      error: '',
      filters: { search: '', no_owner: false, tag: '' },
      setFilters: vi.fn(),
      reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Web-Team')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    usePools.mockReturnValue({
      pools: [], loading: true, error: '',
      filters: { search: '', no_owner: false, tag: '' },
      setFilters: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText(/laden/i)).toBeInTheDocument()
  })

  it('shows core-downgrade banner when Core + existing pools', () => {
    useLicenseLimits.mockReturnValue({ isPlus: false, userLimit: { unlimited: false } })
    usePools.mockReturnValue({
      pools: [
        {
          id: 1, name: 'Existing Pool', description: null, tags: [],
          vm_count_quota: 0, cpu_quota: 0, ram_quota_mb: 0, disk_quota_gb: 0,
          member_count: 0, assignment_count: 0,
          created_at: '2026-05-01T00:00:00', created_by: 'admin',
        },
      ],
      loading: false, error: '',
      filters: { search: '', no_owner: false, tag: '' },
      setFilters: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText(/plus-lizenz/i)).toBeInTheDocument()
  })
})
