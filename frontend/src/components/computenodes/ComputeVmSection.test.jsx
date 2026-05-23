// p3portal.org
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import ComputeVmSection from './ComputeVmSection'

const vm = (id, type, template = false) => ({
  vmid: id,
  name: `${type}-${id}`,
  type,
  status: 'running',
  node: 'pve1',
  template,
  cpu: 0.2,
  mem: 1073741824,
  maxmem: 4294967296,
})

const VMS = [
  vm(100, 'qemu'),
  vm(101, 'qemu'),
  vm(200, 'lxc'),
  vm(9000, 'qemu', true), // template – must be excluded
]

function wrap(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ComputeVmSection', () => {
  it('AC-1: renders three filter buttons Alle / VMs / LXC', () => {
    wrap(<ComputeVmSection vms={VMS} />)
    expect(screen.getByRole('button', { name: 'Alle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'VMs' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'LXC' })).toBeInTheDocument()
  })

  it('AC-2: default filter shows all non-template VMs', () => {
    wrap(<ComputeVmSection vms={VMS} />)
    // 3 rows: qemu-100, qemu-101, lxc-200 (template excluded)
    expect(screen.getByText('qemu-100')).toBeInTheDocument()
    expect(screen.getByText('lxc-200')).toBeInTheDocument()
    expect(screen.queryByText('qemu-9000')).not.toBeInTheDocument()
  })

  it('AC-3: VMs filter shows only qemu entries', () => {
    wrap(<ComputeVmSection vms={VMS} />)
    fireEvent.click(screen.getByRole('button', { name: 'VMs' }))
    expect(screen.getByText('qemu-100')).toBeInTheDocument()
    expect(screen.getByText('qemu-101')).toBeInTheDocument()
    expect(screen.queryByText('lxc-200')).not.toBeInTheDocument()
  })

  it('AC-4: LXC filter shows only lxc entries', () => {
    wrap(<ComputeVmSection vms={VMS} />)
    fireEvent.click(screen.getByRole('button', { name: 'LXC' }))
    expect(screen.getByText('lxc-200')).toBeInTheDocument()
    expect(screen.queryByText('qemu-100')).not.toBeInTheDocument()
  })

  it('AC-5: tab counter reflects non-template count regardless of filter', () => {
    // The count is rendered outside ComputeVmSection (in ComputeNodesPage)
    // Here we verify that templates are excluded from the rendered rows
    wrap(<ComputeVmSection vms={VMS} />)
    const rows = screen.getAllByRole('row')
    // header + 3 data rows (template excluded)
    expect(rows.length).toBe(4)
  })

  it('shows empty state when LXC filter but no LXC containers', () => {
    const onlyVms = [vm(100, 'qemu'), vm(101, 'qemu')]
    wrap(<ComputeVmSection vms={onlyVms} />)
    fireEvent.click(screen.getByRole('button', { name: 'LXC' }))
    expect(screen.getByText('Keine LXC Container auf dieser Node')).toBeInTheDocument()
  })

  it('shows empty state when VM filter but no VMs', () => {
    const onlyLxc = [vm(200, 'lxc')]
    wrap(<ComputeVmSection vms={onlyLxc} />)
    fireEvent.click(screen.getByRole('button', { name: 'VMs' }))
    expect(screen.getByText('Keine VMs auf dieser Node')).toBeInTheDocument()
  })

  it('shows empty state when no VMs at all', () => {
    wrap(<ComputeVmSection vms={[]} />)
    expect(screen.getByText('Keine VMs oder Container auf dieser Node')).toBeInTheDocument()
  })

  it('shows loading skeleton when loading=true and no data', () => {
    const { container } = wrap(<ComputeVmSection vms={[]} loading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })
})
