// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Tests für die Approvals-Page (Approver-Sicht).
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('./hooks', () => ({
  useApprovalsList: vi.fn(),
  useMyApprovalsList: vi.fn(),
  useApprovalCount: vi.fn(() => ({ data: { count: 0 } })),
  useApproveApproval: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useRejectApproval: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCancelApproval: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useResubmitApproval: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useApprovalRules: vi.fn(() => ({ data: [], isLoading: false })),
  useWorkflowConfig: vi.fn(() => ({ data: { enabled: false, max_approval_rules: 3, allow_self_approval_supported: false }, isLoading: false })),
  useToggleWorkflow: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useCreateRule: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateRule: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteRule: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useApproval: vi.fn(),
}))

vi.mock('../../hooks/useCapability', () => ({
  useCapability: vi.fn((key) => key === 'approval_workflow_enabled'),
  useCapabilities: vi.fn(() => ({ approval_workflow_enabled: true })),
  useCapabilityList: vi.fn(() => []),
}))

import { useApprovalsList } from './hooks'
import ApprovalsPage from './Page'

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ApprovalsPage', () => {
  beforeEach(() => {
    useApprovalsList.mockReturnValue({ data: { items: [], total: 0 }, isLoading: false })
  })

  it('renders heading', () => {
    render(<ApprovalsPage />, { wrapper })
    expect(screen.getByText('Freigaben')).toBeInTheDocument()
  })

  it('shows empty state when no items', () => {
    render(<ApprovalsPage />, { wrapper })
    expect(screen.getByText('Keine Anträge vorhanden')).toBeInTheDocument()
  })

  it('shows loading state', () => {
    useApprovalsList.mockReturnValue({ data: null, isLoading: true })
    render(<ApprovalsPage />, { wrapper })
    expect(screen.getByText('Lade …')).toBeInTheDocument()
  })

  it('shows item count badge when items present', () => {
    useApprovalsList.mockReturnValue({
      data: {
        items: [
          {
            id: 'appr_1', action_type: 'playbook_run', action_target: 'vm_deploy.yml',
            requester_username: 'alice', requested_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            status: 'pending', payload: {}, rule_snapshot: {}, can_approve: true, is_own_request: false,
          },
        ],
        total: 1,
      },
      isLoading: false,
    })
    render(<ApprovalsPage />, { wrapper })
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getAllByText('Playbook-Ausführung').length).toBeGreaterThan(0)
  })
})
