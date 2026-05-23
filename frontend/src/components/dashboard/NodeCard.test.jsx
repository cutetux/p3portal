// p3portal.org
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import NodeCard from './NodeCard'

const baseNode = {
  node: 'pve1',
  status: 'online',
  cpu: 0.4,
  maxcpu: 8,
  mem: 4294967296,
  maxmem: 17179869184,
  disk: 10737418240,
  maxdisk: 107374182400,
  uptime: 86400,
}

describe('NodeCard', () => {
  it('renders node name', () => {
    render(<NodeCard node={baseNode} />)
    expect(screen.getByText('pve1')).toBeInTheDocument()
  })

  it('renders online status badge', () => {
    render(<NodeCard node={baseNode} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('does NOT render portal_node_name badge when field is absent', () => {
    render(<NodeCard node={baseNode} />)
    // No badge element with cluster name
    expect(screen.queryByText('#production')).not.toBeInTheDocument()
    expect(screen.queryByText('#staging')).not.toBeInTheDocument()
  })

  it('renders portal_node_name badge when set', () => {
    render(<NodeCard node={{ ...baseNode, portal_node_name: 'Production' }} />)
    expect(screen.getByText('#production')).toBeInTheDocument()
  })

  it('renders portal_node_name for second cluster', () => {
    render(<NodeCard node={{ ...baseNode, portal_node_name: 'Staging' }} />)
    expect(screen.getByText('#staging')).toBeInTheDocument()
  })

  it('shows resource bars when node is online', () => {
    render(<NodeCard node={baseNode} />)
    expect(screen.getByText(/CPU/)).toBeInTheDocument()
    expect(screen.getByText(/RAM/)).toBeInTheDocument()
    expect(screen.getByText(/Disk/)).toBeInTheDocument()
  })

  it('hides resource bars when node is offline', () => {
    render(<NodeCard node={{ ...baseNode, status: 'offline' }} />)
    expect(screen.queryByText(/CPU \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/RAM \(/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Disk Space/)).not.toBeInTheDocument()
  })

  it('shows offline status badge when node is offline', () => {
    render(<NodeCard node={{ ...baseNode, status: 'offline' }} />)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('shows uptime label when uptime is set', () => {
    render(<NodeCard node={{ ...baseNode, uptime: 90000 }} />)
    // 90000s = 1d 1h
    expect(screen.getByText(/Uptime:/)).toBeInTheDocument()
  })

  it('hides uptime label when uptime is 0', () => {
    render(<NodeCard node={{ ...baseNode, uptime: 0 }} />)
    expect(screen.queryByText(/Uptime:/)).not.toBeInTheDocument()
  })

  it('renders portal_node_name badge alongside node name independently', () => {
    render(<NodeCard node={{ ...baseNode, portal_node_name: 'DC-East' }} />)
    expect(screen.getByText('pve1')).toBeInTheDocument()
    expect(screen.getByText('#dc-east')).toBeInTheDocument()
  })

  // ── PROJ-39: selected + onClick props ─────────────────────────────────────

  it('applies orange ring class when selected=true', () => {
    const { container } = render(<NodeCard node={baseNode} selected />)
    const card = container.firstChild
    expect(card.className).toMatch(/border-orange-500/)
    expect(card.className).toMatch(/ring-2/)
  })

  it('does NOT apply orange ring when selected=false', () => {
    const { container } = render(<NodeCard node={baseNode} selected={false} />)
    const card = container.firstChild
    expect(card.className).not.toMatch(/ring-2/)
  })

  it('applies cursor-pointer when onClick is set', () => {
    const { container } = render(<NodeCard node={baseNode} onClick={() => {}} />)
    const card = container.firstChild
    expect(card.className).toMatch(/cursor-pointer/)
  })

  it('does NOT apply cursor-pointer when onClick is omitted', () => {
    const { container } = render(<NodeCard node={baseNode} />)
    const card = container.firstChild
    expect(card.className).not.toMatch(/cursor-pointer/)
  })

  it('calls onClick handler when card is clicked', () => {
    const handler = vi.fn()
    const { container } = render(<NodeCard node={baseNode} onClick={handler} />)
    fireEvent.click(container.firstChild)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('shows ping tooltip when response_time_ms is set', () => {
    render(<NodeCard node={{ ...baseNode, response_time_ms: 12.5 }} />)
    const onlineBadge = screen.getByTitle('13 ms')
    expect(onlineBadge).toBeInTheDocument()
  })

  it('shows 3-column resource grid for online nodes', () => {
    const { container } = render(<NodeCard node={baseNode} />)
    const grid = container.querySelector('.grid.grid-cols-3')
    expect(grid).not.toBeNull()
  })
})
