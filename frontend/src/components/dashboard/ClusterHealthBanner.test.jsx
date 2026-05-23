// p3portal.org
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import ClusterHealthBanner from './ClusterHealthBanner'

beforeEach(() => {
  sessionStorage.clear()
})

const statusOk = { quorum: true, node_count: 2, ha_status: 'active' }
const statusNoQuorum = { quorum: false, node_count: 2, ha_status: 'none' }
const statusNoHa = { quorum: true, node_count: 2, ha_status: 'none' }

describe('ClusterHealthBanner – cluster status', () => {
  it('renders nothing when status is null', () => {
    const { container } = render(<ClusterHealthBanner status={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for single-node (node_count=1)', () => {
    const { container } = render(
      <ClusterHealthBanner status={{ quorum: true, node_count: 1, ha_status: 'active' }} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows green cluster-ok banner with node count', () => {
    render(<ClusterHealthBanner status={statusOk} />)
    expect(screen.getByText(/Cluster OK/)).toBeInTheDocument()
    expect(screen.getByText(/2 Nodes/)).toBeInTheDocument()
  })

  it('shows red no-quorum banner', () => {
    render(<ClusterHealthBanner status={statusNoQuorum} />)
    expect(screen.getByText(/Kein Quorum/)).toBeInTheDocument()
  })

  it('shows yellow quorum-ok-but-no-ha banner', () => {
    render(<ClusterHealthBanner status={statusNoHa} />)
    expect(screen.getByText(/Quorum OK/)).toBeInTheDocument()
  })

  it('dismisses cluster banner via button', () => {
    render(<ClusterHealthBanner status={statusOk} />)
    const btns = screen.getAllByRole('button', { name: 'Ausblenden' })
    fireEvent.click(btns[btns.length - 1])
    expect(screen.queryByText(/Cluster OK/)).not.toBeInTheDocument()
  })
})

describe('ClusterHealthBanner – unreachable_nodes', () => {
  it('renders nothing when unreachable_nodes is empty', () => {
    const { container } = render(
      <ClusterHealthBanner status={null} unreachable_nodes={[]} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows orange warning with node names', () => {
    render(<ClusterHealthBanner status={null} unreachable_nodes={['Production', 'Staging']} />)
    expect(screen.getByText(/Nicht erreichbar:/)).toBeInTheDocument()
    expect(screen.getByText(/Production/)).toBeInTheDocument()
    expect(screen.getByText(/Staging/)).toBeInTheDocument()
  })

  it('shows single unreachable node name', () => {
    render(<ClusterHealthBanner status={null} unreachable_nodes={['DC-East']} />)
    expect(screen.getByText(/DC-East/)).toBeInTheDocument()
  })

  it('dismisses unreachable banner independently', () => {
    render(
      <ClusterHealthBanner status={statusOk} unreachable_nodes={['Production']} />
    )
    // Both banners visible
    expect(screen.getByText(/Production/)).toBeInTheDocument()
    expect(screen.getByText(/Cluster OK/)).toBeInTheDocument()

    // Dismiss only the unreachable banner (first Ausblenden button)
    const btns = screen.getAllByRole('button', { name: 'Ausblenden' })
    fireEvent.click(btns[0])

    expect(screen.queryByText(/Production/)).not.toBeInTheDocument()
    // Cluster OK banner still visible
    expect(screen.getByText(/Cluster OK/)).toBeInTheDocument()
  })

  it('uses separate session storage keys for each banner', () => {
    render(
      <ClusterHealthBanner status={statusOk} unreachable_nodes={['DC-East']} />
    )
    const btns = screen.getAllByRole('button', { name: 'Ausblenden' })
    // Dismiss cluster banner
    fireEvent.click(btns[btns.length - 1])

    expect(screen.queryByText(/Cluster OK/)).not.toBeInTheDocument()
    // Unreachable banner still visible
    expect(screen.getByText(/DC-East/)).toBeInTheDocument()
  })

  it('default prop is empty array (no unreachable banner without prop)', () => {
    render(<ClusterHealthBanner status={statusOk} />)
    expect(screen.queryByText(/Nicht erreichbar/)).not.toBeInTheDocument()
  })
})
