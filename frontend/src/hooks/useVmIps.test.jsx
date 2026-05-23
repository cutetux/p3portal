// p3portal.org
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import useVmIps, { vmIpKey } from './useVmIps'

vi.mock('../api/vms', () => ({
  getVmIp: vi.fn(),
}))

import { getVmIp } from '../api/vms'

const running = (node, vmid, type = 'qemu') => ({ node, vmid, type, status: 'running', template: 0 })
const stopped = (node, vmid) => ({ node, vmid, type: 'qemu', status: 'stopped', template: 0 })
const tmpl    = (node, vmid) => ({ node, vmid, type: 'qemu', status: 'stopped', template: 1 })
const lxc     = (node, vmid) => ({ node, vmid, type: 'lxc',  status: 'running', template: 0 })

describe('useVmIps', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty object initially, then fills IPs asynchronously', async () => {
    getVmIp.mockResolvedValue({ ip: '192.168.2.10' })
    const vms = [running('pve1', 101)]

    const { result } = renderHook(() => useVmIps(vms))

    // Initially empty (loading hasn't resolved yet)
    expect(result.current).toEqual({})

    await waitFor(() => expect(result.current['pve1/101']).toBe('192.168.2.10'))
    expect(getVmIp).toHaveBeenCalledWith('pve1', 101, 'qemu')
  })

  it('does not load IP for stopped VMs', async () => {
    const vms = [stopped('pve1', 102)]
    renderHook(() => useVmIps(vms))
    await new Promise(r => setTimeout(r, 50))
    expect(getVmIp).not.toHaveBeenCalled()
  })

  it('does not load IP for template VMs', async () => {
    const vms = [tmpl('pve1', 103)]
    renderHook(() => useVmIps(vms))
    await new Promise(r => setTimeout(r, 50))
    expect(getVmIp).not.toHaveBeenCalled()
  })

  it('uses lxc type for LXC containers', async () => {
    getVmIp.mockResolvedValue({ ip: '10.0.0.5' })
    const vms = [lxc('pve1', 200)]

    const { result } = renderHook(() => useVmIps(vms))
    await waitFor(() => expect(result.current['pve1/200']).toBe('10.0.0.5'))
    expect(getVmIp).toHaveBeenCalledWith('pve1', 200, 'lxc')
  })

  it('stores null when API returns null ip (no guest agent)', async () => {
    getVmIp.mockResolvedValue({ ip: null })
    const vms = [running('pve1', 104)]

    const { result } = renderHook(() => useVmIps(vms))
    await waitFor(() => expect('pve1/104' in result.current).toBe(true))
    expect(result.current['pve1/104']).toBeNull()
  })

  it('stores null on API error (silent failure)', async () => {
    getVmIp.mockRejectedValue(new Error('Network error'))
    const vms = [running('pve1', 105)]

    const { result } = renderHook(() => useVmIps(vms))
    await waitFor(() => expect('pve1/105' in result.current).toBe(true))
    expect(result.current['pve1/105']).toBeNull()
  })

  it('loads multiple VMs in parallel', async () => {
    getVmIp
      .mockResolvedValueOnce({ ip: '192.168.2.10' })
      .mockResolvedValueOnce({ ip: '192.168.2.11' })
    const vms = [running('pve1', 101), running('pve1', 102)]

    const { result } = renderHook(() => useVmIps(vms))
    await waitFor(() =>
      expect(result.current['pve1/101']).toBe('192.168.2.10') &&
      expect(result.current['pve1/102']).toBe('192.168.2.11')
    )
    expect(getVmIp).toHaveBeenCalledTimes(2)
  })

  it('does not re-request on re-render (cache via ref)', async () => {
    getVmIp.mockResolvedValue({ ip: '192.168.2.10' })
    const vms = [running('pve1', 101)]

    const { result, rerender } = renderHook(() => useVmIps(vms))
    await waitFor(() => expect(result.current['pve1/101']).toBe('192.168.2.10'))

    // Re-render with same VMs (simulates auto-refresh)
    rerender()
    await new Promise(r => setTimeout(r, 50))
    // Should still only be called once
    expect(getVmIp).toHaveBeenCalledTimes(1)
  })

  it('skips already-loaded VMs when new ones are added', async () => {
    getVmIp
      .mockResolvedValueOnce({ ip: '192.168.2.10' })
      .mockResolvedValueOnce({ ip: '192.168.2.20' })

    const vmsV1 = [running('pve1', 101)]
    const vmsV2 = [running('pve1', 101), running('pve1', 102)]

    const { result, rerender } = renderHook(({ vms }) => useVmIps(vms), {
      initialProps: { vms: vmsV1 }
    })
    await waitFor(() => expect(result.current['pve1/101']).toBe('192.168.2.10'))
    expect(getVmIp).toHaveBeenCalledTimes(1)

    rerender({ vms: vmsV2 })
    await waitFor(() => expect(result.current['pve1/102']).toBe('192.168.2.20'))
    // Only called for new VM, not again for existing one
    expect(getVmIp).toHaveBeenCalledTimes(2)
  })
})

// ── vmIpKey helper ────────────────────────────────────────────────────────────

describe('vmIpKey', () => {
  it('returns "node/vmid" when portal_node_name is absent', () => {
    expect(vmIpKey({ node: 'pve1', vmid: 101 })).toBe('pve1/101')
  })

  it('returns "node/vmid" when portal_node_name is null', () => {
    expect(vmIpKey({ node: 'pve1', vmid: 101, portal_node_name: null })).toBe('pve1/101')
  })

  it('returns "portal_node_name/node/vmid" when portal_node_name is set', () => {
    expect(vmIpKey({ node: 'pve1', vmid: 101, portal_node_name: 'Production' })).toBe('Production/pve1/101')
  })

  it('produces distinct keys for same node+vmid on different portal nodes', () => {
    const key1 = vmIpKey({ node: 'pve', vmid: 100, portal_node_name: 'DC-East' })
    const key2 = vmIpKey({ node: 'pve', vmid: 100, portal_node_name: 'DC-West' })
    expect(key1).not.toBe(key2)
  })
})

// ── Multi-node IP loading ─────────────────────────────────────────────────────

describe('useVmIps – multi-node', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores IP under composite key when portal_node_name is set', async () => {
    getVmIp.mockResolvedValue({ ip: '10.0.1.5' })
    const vms = [{ node: 'pve', vmid: 100, type: 'qemu', status: 'running', template: 0, portal_node_name: 'Production' }]

    const { result } = renderHook(() => useVmIps(vms))
    await waitFor(() => expect(result.current['Production/pve/100']).toBe('10.0.1.5'))
    expect(getVmIp).toHaveBeenCalledWith('pve', 100, 'qemu')
  })

  it('keeps IPs separate for same node+vmid on two portal nodes', async () => {
    getVmIp
      .mockResolvedValueOnce({ ip: '10.0.1.5' })
      .mockResolvedValueOnce({ ip: '10.0.2.5' })

    const vms = [
      { node: 'pve', vmid: 100, type: 'qemu', status: 'running', template: 0, portal_node_name: 'DC-East' },
      { node: 'pve', vmid: 100, type: 'qemu', status: 'running', template: 0, portal_node_name: 'DC-West' },
    ]

    const { result } = renderHook(() => useVmIps(vms))
    await waitFor(() =>
      result.current['DC-East/pve/100'] != null &&
      result.current['DC-West/pve/100'] != null
    )
    expect(result.current['DC-East/pve/100']).toBe('10.0.1.5')
    expect(result.current['DC-West/pve/100']).toBe('10.0.2.5')
    expect(getVmIp).toHaveBeenCalledTimes(2)
  })
})
