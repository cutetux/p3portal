// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ComputeBackupsTab from './ComputeBackupsTab'

vi.mock('../../api/cluster', () => ({
  getNodeBackups: vi.fn(),
}))

import { getNodeBackups } from '../../api/cluster'

const BACKUPS = [
  { upid: 'UPID:pve1:011', vmid: 100, status: 'OK',    starttime: 1715010000, duration: 300 },
  { upid: 'UPID:pve1:012', vmid: 101, status: 'ERROR', starttime: 1715020000, duration: 45 },
]

describe('ComputeBackupsTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-15: fetches backup tasks when active=true', async () => {
    getNodeBackups.mockResolvedValue(BACKUPS)
    render(<ComputeBackupsTab nodeName="pve1" active={true} />)
    await screen.findByText('100')
    expect(getNodeBackups).toHaveBeenCalledWith('pve1')
  })

  it('AC-16: shows VMID, Status, Startzeit, Dauer columns', async () => {
    getNodeBackups.mockResolvedValue(BACKUPS)
    render(<ComputeBackupsTab nodeName="pve1" active={true} />)
    await screen.findByText('100')
    expect(screen.getByText('101')).toBeInTheDocument()
    // Duration 300s = 5m 0s
    expect(screen.getByText('5m 0s')).toBeInTheDocument()
    expect(screen.getByText('45s')).toBeInTheDocument()
  })

  it('AC-17: no action buttons rendered', async () => {
    getNodeBackups.mockResolvedValue(BACKUPS)
    render(<ComputeBackupsTab nodeName="pve1" active={true} />)
    await screen.findByText('100')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('AC-18: empty state when no backups', async () => {
    getNodeBackups.mockResolvedValue([])
    render(<ComputeBackupsTab nodeName="pve1" active={true} />)
    expect(await screen.findByText('Keine Backups für diese Node gefunden')).toBeInTheDocument()
  })

  it('shows loading skeleton before data arrives', () => {
    getNodeBackups.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ComputeBackupsTab nodeName="pve1" active={true} />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('shows error message on API failure', async () => {
    getNodeBackups.mockRejectedValue(new Error('timeout'))
    render(<ComputeBackupsTab nodeName="pve1" active={true} />)
    expect(await screen.findByText('Backup-Liste konnte nicht geladen werden.')).toBeInTheDocument()
  })

  it('does NOT fetch when active=false', () => {
    render(<ComputeBackupsTab nodeName="pve1" active={false} />)
    expect(getNodeBackups).not.toHaveBeenCalled()
  })
})
