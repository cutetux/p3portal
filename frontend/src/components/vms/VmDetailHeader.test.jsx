// p3portal.org
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import VmDetailHeader from './VmDetailHeader'

vi.mock('./VmActionButtons', () => ({
  default: ({ vm }) => <div data-testid="vm-action-buttons" data-status={vm.status} />,
}))
vi.mock('../ui/StatusBadge', () => ({
  default: ({ status }) => <span data-testid="status-badge">{status}</span>,
}))

const makeDetail = (overrides = {}) => ({
  vmid: 100,
  name: 'test-vm',
  type: 'qemu',
  status: 'running',
  node: 'pve1',
  ip: '192.168.1.10',
  uptime: 3600,
  tags: [],
  is_template: false,
  cpu_usage: 0.12,
  cpu_cores: 4,
  mem_used: 2147483648,
  mem_total: 8589934592,
  bios: 'seabios',
  ostype: 'l26',
  networks: [],
  disks: [],
  ...overrides,
})

function render_header(detail, isOperator = false) {
  return render(
    <MemoryRouter>
      <VmDetailHeader detail={detail} isOperator={isOperator} onActionSuccess={() => {}} />
    </MemoryRouter>
  )
}

describe('VmDetailHeader', () => {
  it('zeigt VM-Name an', () => {
    render_header(makeDetail())
    expect(screen.getByText('test-vm')).toBeInTheDocument()
  })

  it('zeigt VM-Typ-Badge an', () => {
    render_header(makeDetail({ type: 'qemu' }))
    expect(screen.getByText('VM')).toBeInTheDocument()
  })

  it('zeigt CT-Badge für LXC', () => {
    render_header(makeDetail({ type: 'lxc' }))
    expect(screen.getByText('CT')).toBeInTheDocument()
  })

  it('zeigt tmpl-Badge für Templates', () => {
    render_header(makeDetail({ is_template: true }))
    expect(screen.getByText('tmpl')).toBeInTheDocument()
  })

  it('zeigt StatusBadge an', () => {
    render_header(makeDetail({ status: 'running' }))
    expect(screen.getByTestId('status-badge')).toHaveTextContent('running')
  })

  it('zeigt Node und VMID an', () => {
    render_header(makeDetail({ node: 'pve1', vmid: 100 }))
    expect(screen.getByText('pve1')).toBeInTheDocument()
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('zeigt IP-Adresse wenn vorhanden', () => {
    render_header(makeDetail({ ip: '192.168.1.10' }))
    expect(screen.getByText('192.168.1.10')).toBeInTheDocument()
  })

  it('versteckt IP wenn null', () => {
    render_header(makeDetail({ ip: null }))
    expect(screen.queryByText('192.168.1.10')).not.toBeInTheDocument()
  })

  it('zeigt Uptime bei laufender VM', () => {
    render_header(makeDetail({ status: 'running', uptime: 3660 }))
    expect(screen.getByText('1h 1m')).toBeInTheDocument()
  })

  it('versteckt Uptime bei gestoppter VM', () => {
    render_header(makeDetail({ status: 'stopped', uptime: 0 }))
    expect(screen.queryByText(/Uptime/)).not.toBeInTheDocument()
  })

  it('zeigt Tags als Badges', () => {
    render_header(makeDetail({ tags: ['prod', 'web'] }))
    expect(screen.getByText('prod')).toBeInTheDocument()
    expect(screen.getByText('web')).toBeInTheDocument()
  })

  it('zeigt Power-Buttons für Operator-Nutzer', () => {
    render_header(makeDetail(), true)
    expect(screen.getByTestId('vm-action-buttons')).toBeInTheDocument()
  })

  it('versteckt Power-Buttons für Viewer-Nutzer', () => {
    render_header(makeDetail(), false)
    expect(screen.queryByTestId('vm-action-buttons')).not.toBeInTheDocument()
  })

  it('versteckt Power-Buttons für Templates (auch als Operator)', () => {
    render_header(makeDetail({ is_template: true }), true)
    expect(screen.queryByTestId('vm-action-buttons')).not.toBeInTheDocument()
  })
})
