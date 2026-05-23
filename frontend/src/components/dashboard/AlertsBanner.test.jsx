// p3portal.org
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mock the alerts API
vi.mock('../../api/alerts', () => ({
  listAlertStates: vi.fn(),
  acknowledgeAlert: vi.fn().mockResolvedValue({}),
}))

import { listAlertStates, acknowledgeAlert } from '../../api/alerts'
import AlertsBanner from './AlertsBanner'

describe('AlertsBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when no active alerts', async () => {
    listAlertStates.mockResolvedValue([])
    const { container } = render(<AlertsBanner />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders nothing when all alerts are in "ok" state', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'ok', rule_name: 'CPU', last_value: 50 },
    ])
    const { container } = render(<AlertsBanner />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  it('renders warning alert in yellow style', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'warning', rule_name: 'CPU Alert', last_value: 82 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      expect(screen.getByText('Warnung')).toBeInTheDocument()
      expect(screen.getByText('CPU Alert')).toBeInTheDocument()
    })
  })

  it('renders critical alert in red style', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 2, vmid: '101', node_id: 1, severity: 'critical', state: 'critical', rule_name: 'RAM Alert', last_value: 96 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      expect(screen.getByText('Kritisch')).toBeInTheDocument()
      expect(screen.getByText('RAM Alert')).toBeInTheDocument()
    })
  })

  it('sorts critical alerts before warning alerts', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'warning', rule_name: 'Warn Rule', last_value: 80 },
      { rule_id: 2, vmid: '101', node_id: 1, severity: 'critical', state: 'critical', rule_name: 'Crit Rule', last_value: 96 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      const severities = screen.getAllByText(/Kritisch|Warnung/)
      expect(severities[0]).toHaveTextContent('Kritisch')
      expect(severities[1]).toHaveTextContent('Warnung')
    })
  })

  it('shows Bestätigen button for each active alert', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'warning', rule_name: 'CPU', last_value: 82 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      expect(screen.getByText('Bestätigen')).toBeInTheDocument()
    })
  })

  it('filters out pending-state alerts (only shows warning/critical)', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'pending', rule_name: 'Pending Alert', last_value: 75 },
    ])
    const { container } = render(<AlertsBanner />)
    await waitFor(() => {
      expect(container.firstChild).toBeNull()
    })
  })

  // BUG-34-1 fix: MetricLabel uses actual metric from AlertStateResponse
  it('BUG-34-1 fix: RAM alert (mem_percent) shows RAM label in metric display', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'warning',
        rule_name: 'My Rule', metric: 'mem_percent', last_value: 90 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      // MetricLabel for mem_percent renders "RAM 90.0 % (Schwellwert ? %)"
      expect(screen.getByText(/RAM 90\.0/)).toBeInTheDocument()
      // Must NOT show "CPU 90.0" (which the bug produced)
      expect(screen.queryByText(/CPU 90\.0/)).not.toBeInTheDocument()
    })
  })

  it('BUG-34-1 fix: CPU alert (cpu_percent) shows CPU label in metric display', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 2, vmid: '101', node_id: 1, severity: 'critical', state: 'critical',
        rule_name: 'My Rule', metric: 'cpu_percent', last_value: 95 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      // MetricLabel for cpu_percent renders "CPU 95.0 % (Schwellwert ? %)"
      expect(screen.getByText(/CPU 95\.0/)).toBeInTheDocument()
    })
  })

  // BUG-34-2 fix: acknowledgeAlert API is called with last_event_id on Bestätigen click
  it('BUG-34-2 fix: Bestätigen calls acknowledgeAlert with last_event_id', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'warning',
        rule_name: 'CPU', last_value: 82, last_event_id: 42 },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      expect(screen.getByText('Bestätigen')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Bestätigen'))
    await waitFor(() => {
      expect(acknowledgeAlert).toHaveBeenCalledWith(42)
    })
  })

  it('BUG-34-2 fix: Bestätigen still dismisses locally when last_event_id is null', async () => {
    listAlertStates.mockResolvedValue([
      { rule_id: 1, vmid: '100', node_id: 1, severity: 'warning', state: 'warning',
        rule_name: 'CPU', last_value: 82, last_event_id: null },
    ])
    render(<AlertsBanner />)
    await waitFor(() => {
      expect(screen.getByText('Bestätigen')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Bestätigen'))
    await waitFor(() => {
      expect(acknowledgeAlert).not.toHaveBeenCalled()
      expect(screen.queryByText('Bestätigen')).not.toBeInTheDocument()
    })
  })
})
