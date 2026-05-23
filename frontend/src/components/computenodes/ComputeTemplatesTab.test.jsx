// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ComputeTemplatesTab from './ComputeTemplatesTab'

const tmpl = (id, type, storage = 'local-lvm') => ({
  vmid: id,
  name: `tmpl-${id}`,
  type,
  template: true,
  node: 'pve1',
  disk_storage: storage,
})

describe('ComputeTemplatesTab', () => {
  it('AC-7: renders templates that have template===true', () => {
    const vms = [
      tmpl(9000, 'qemu'),
      tmpl(9001, 'lxc'),
      { vmid: 100, name: 'running-vm', type: 'qemu', template: false, node: 'pve1' }, // not a template
    ]
    render(<ComputeTemplatesTab vms={vms} />)
    expect(screen.getByText('tmpl-9000')).toBeInTheDocument()
    expect(screen.getByText('tmpl-9001')).toBeInTheDocument()
    expect(screen.queryByText('running-vm')).not.toBeInTheDocument()
  })

  it('AC-8: shows Name, VMID, Typ badge and Storage columns', () => {
    render(<ComputeTemplatesTab vms={[tmpl(9000, 'qemu', 'ceph-pool')]} />)
    expect(screen.getByText('tmpl-9000')).toBeInTheDocument()
    expect(screen.getByText('9000')).toBeInTheDocument()
    expect(screen.getByText('VM')).toBeInTheDocument()
    expect(screen.getByText('ceph-pool')).toBeInTheDocument()
  })

  it('AC-8: shows LXC badge for lxc templates', () => {
    render(<ComputeTemplatesTab vms={[tmpl(9001, 'lxc')]} />)
    expect(screen.getByText('LXC')).toBeInTheDocument()
  })

  it('AC-9: empty state when no templates', () => {
    render(<ComputeTemplatesTab vms={[]} />)
    expect(screen.getByText('Keine Templates auf dieser Node')).toBeInTheDocument()
  })

  it('AC-9: empty state when all vms are non-templates', () => {
    const vms = [{ vmid: 100, name: 'vm', type: 'qemu', template: false, node: 'pve1' }]
    render(<ComputeTemplatesTab vms={vms} />)
    expect(screen.getByText('Keine Templates auf dieser Node')).toBeInTheDocument()
  })

  it('shows loading skeleton when loading=true and no data', () => {
    const { container } = render(<ComputeTemplatesTab vms={[]} loading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('accepts template===1 (integer truthy) as valid template', () => {
    const vms = [{ vmid: 9002, name: 'legacy-tmpl', type: 'qemu', template: 1, node: 'pve1', disk_storage: 'local' }]
    render(<ComputeTemplatesTab vms={vms} />)
    expect(screen.getByText('legacy-tmpl')).toBeInTheDocument()
  })
})
