// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ComputeScheduledJobsTab from './ComputeScheduledJobsTab'

vi.mock('../../api/license', () => ({
  getLicenseStatus: vi.fn(),
}))
vi.mock('../../api/scheduledJobs', () => ({
  listScheduledJobs: vi.fn(),
}))

import { getLicenseStatus } from '../../api/license'
import { listScheduledJobs } from '../../api/scheduledJobs'

const JOBS = [
  {
    id: 1,
    name: 'Power off pve1',
    job_type: 'power_action',
    cron_expression: '0 2 * * *',
    is_active: true,
    last_run_at: null,
    next_run_at: '2026-05-09T02:00:00',
    config: { node: 'pve1', action: 'shutdown', vmid: 100 },
  },
  {
    id: 2,
    name: 'Deploy on pve2',
    job_type: 'playbook',
    cron_expression: '0 3 * * *',
    is_active: false,
    last_run_at: null,
    next_run_at: null,
    config: { params: { proxmox_node: 'pve2' } },
  },
  {
    id: 3,
    name: 'Deploy on pve1',
    job_type: 'playbook',
    cron_expression: '0 4 * * *',
    is_active: true,
    last_run_at: null,
    next_run_at: null,
    config: { params: { proxmox_node: 'pve1' } },
  },
]

describe('ComputeScheduledJobsTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-23: shows PlusGate for non-plus users', async () => {
    getLicenseStatus.mockResolvedValue({ valid: false })
    render(<ComputeScheduledJobsTab nodeName="pve1" active={true} />)
    expect(await screen.findByText('P3 Plus erforderlich')).toBeInTheDocument()
  })

  it('AC-24: Plus-Nutzer sehen Jobs gefiltert nach Node', async () => {
    getLicenseStatus.mockResolvedValue({ valid: true })
    listScheduledJobs.mockResolvedValue(JOBS)
    render(<ComputeScheduledJobsTab nodeName="pve1" active={true} />)
    await screen.findByText('Power off pve1')
    // Job for pve1
    expect(screen.getByText('Deploy on pve1')).toBeInTheDocument()
    // Job for pve2 should NOT appear
    expect(screen.queryByText('Deploy on pve2')).not.toBeInTheDocument()
  })

  it('AC-25: shows Name, Typ, Cron, Letzter/Nächster Lauf, Status', async () => {
    getLicenseStatus.mockResolvedValue({ valid: true })
    listScheduledJobs.mockResolvedValue(JOBS)
    render(<ComputeScheduledJobsTab nodeName="pve1" active={true} />)
    await screen.findByText('Power off pve1')
    expect(screen.getByText('Power')).toBeInTheDocument()       // job_type badge
    expect(screen.getByText('0 2 * * *')).toBeInTheDocument()  // cron
    // Active status
    expect(screen.getAllByText('Aktiv').length).toBeGreaterThan(0)
  })

  it('AC-26: empty state when no jobs for node', async () => {
    getLicenseStatus.mockResolvedValue({ valid: true })
    listScheduledJobs.mockResolvedValue(JOBS)
    render(<ComputeScheduledJobsTab nodeName="pve99" active={true} />)
    expect(await screen.findByText('Keine Scheduled Jobs für diese Node konfiguriert')).toBeInTheDocument()
  })

  it('does NOT fetch when active=false', () => {
    render(<ComputeScheduledJobsTab nodeName="pve1" active={false} />)
    expect(getLicenseStatus).not.toHaveBeenCalled()
  })

  // BUG-40-1: getLicenseStatus failure leaves isPlus=null → skeleton persists instead of error shown
  // (error message never rendered because isPlus===null check hits first)
  it('shows loading skeleton on API failure (BUG-40-1: error message not reachable)', async () => {
    getLicenseStatus.mockRejectedValue(new Error('Network'))
    const { container } = render(<ComputeScheduledJobsTab nodeName="pve1" active={true} />)
    // Skeleton shows indefinitely – error text NOT visible
    await new Promise(r => setTimeout(r, 50))
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('Scheduled Jobs konnten nicht geladen werden.')).toBeNull()
  })

  it('filters power_action jobs by config.node', async () => {
    getLicenseStatus.mockResolvedValue({ valid: true })
    const jobs = [
      { id: 10, name: 'PA pve1', job_type: 'power_action', cron_expression: '0 * * * *', is_active: true, last_run_at: null, next_run_at: null, config: { node: 'pve1' } },
      { id: 11, name: 'PA pve2', job_type: 'power_action', cron_expression: '0 * * * *', is_active: true, last_run_at: null, next_run_at: null, config: { node: 'pve2' } },
    ]
    listScheduledJobs.mockResolvedValue(jobs)
    render(<ComputeScheduledJobsTab nodeName="pve1" active={true} />)
    await screen.findByText('PA pve1')
    expect(screen.queryByText('PA pve2')).not.toBeInTheDocument()
  })
})
