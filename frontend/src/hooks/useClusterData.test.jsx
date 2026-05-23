// p3portal.org
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useClusterData } from './useClusterData'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/cluster', () => ({
  getNodes: vi.fn(),
  getVms: vi.fn(),
  getClusterStatus: vi.fn(),
}))

import { getNodes, getVms, getClusterStatus } from '../api/cluster'

const FAKE_NODES = [{ node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 8, mem: 2e9, maxmem: 16e9, disk: 5e9, maxdisk: 100e9, uptime: 3600 }]
const FAKE_VMS = [{ vmid: 100, name: 'test-vm', type: 'qemu', status: 'running', node: 'pve1', cpu: 0.05, maxcpu: 2, mem: 1e9, maxmem: 2e9, uptime: 1800 }]
const FAKE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

beforeEach(() => {
  vi.useFakeTimers()
  getNodes.mockResolvedValue(FAKE_NODES)
  getVms.mockResolvedValue(FAKE_VMS)
  getClusterStatus.mockResolvedValue(FAKE_STATUS)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// Flush Promises AND timers (React's scheduler uses setTimeout(fn,0) in JSDOM).
// vi.advanceTimersByTime(0) runs zero-delay timers; multiple rounds handle chained chains.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await act(async () => { vi.advanceTimersByTime(0) })
  }
}

describe('useClusterData', () => {
  it('starts in loading state before first fetch completes', () => {
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.nodes).toEqual([])
    expect(result.current.clusterStatus).toBeNull()
  })

  it('fetches all three endpoints on mount and populates state', async () => {
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()

    expect(result.current.nodes).toEqual(FAKE_NODES)
    expect(result.current.vms).toEqual(FAKE_VMS)
    expect(result.current.clusterStatus).toEqual(FAKE_STATUS)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.lastUpdated).toBeInstanceOf(Date)
  })

  it('calls each API function exactly once on mount', async () => {
    renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()

    expect(getNodes).toHaveBeenCalledTimes(1)
    expect(getVms).toHaveBeenCalledTimes(1)
    expect(getClusterStatus).toHaveBeenCalledTimes(1)
  })

  it('polls again after 30 seconds', async () => {
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()
    expect(getNodes).toHaveBeenCalledTimes(1)

    // Advance fake clock by exactly 30s — triggers the setInterval callback
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    await flushMicrotasks()

    expect(getNodes).toHaveBeenCalledTimes(2)
    expect(getVms).toHaveBeenCalledTimes(2)
    expect(getClusterStatus).toHaveBeenCalledTimes(2)
    expect(result.current.nodes).toEqual(FAKE_NODES)
  })

  it('sets error state when API fails and keeps loading=false', async () => {
    const apiError = new Error('Network error')
    getNodes.mockRejectedValue(apiError)

    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()

    expect(result.current.error).toBe(apiError)
    expect(result.current.loading).toBe(false)
    expect(result.current.nodes).toEqual([])
  })

  it('clears error state on a successful retry after 30 seconds', async () => {
    getNodes.mockRejectedValueOnce(new Error('fail'))
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()
    expect(result.current.error).toBeTruthy()

    getNodes.mockResolvedValue(FAKE_NODES)
    await act(async () => { vi.advanceTimersByTime(30_000) })
    await flushMicrotasks()

    expect(result.current.error).toBeNull()
    expect(result.current.nodes).toEqual(FAKE_NODES)
  })

  it('refresh() triggers an immediate re-fetch', async () => {
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()
    expect(getNodes).toHaveBeenCalledTimes(1)

    act(() => { result.current.refresh() })
    await flushMicrotasks()

    expect(getNodes).toHaveBeenCalledTimes(2)
  })

  // PROJ-33: force=true must be passed to all three API functions on refresh
  it('refresh() passes force=true to all three API functions', async () => {
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()

    act(() => { result.current.refresh() })
    await flushMicrotasks()

    // First call (mount): force=false (undefined / default)
    expect(getNodes).toHaveBeenNthCalledWith(1, false)
    expect(getVms).toHaveBeenNthCalledWith(1, false)
    expect(getClusterStatus).toHaveBeenNthCalledWith(1, false)

    // Second call (refresh): force=true
    expect(getNodes).toHaveBeenNthCalledWith(2, true)
    expect(getVms).toHaveBeenNthCalledWith(2, true)
    expect(getClusterStatus).toHaveBeenNthCalledWith(2, true)
  })

  // PROJ-33: Auto-poll must NOT pass force=true (only refresh() does)
  it('auto-poll after 30 s passes force=false', async () => {
    renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()

    await act(async () => { vi.advanceTimersByTime(30_000) })
    await flushMicrotasks()

    // Both the mount call and the timer call use force=false
    expect(getNodes).toHaveBeenNthCalledWith(2, false)
    expect(getVms).toHaveBeenNthCalledWith(2, false)
    expect(getClusterStatus).toHaveBeenNthCalledWith(2, false)
  })

  // PROJ-33: refreshing state is true during force-refresh, false before and after
  it('refreshing is true while force-refresh is in flight, false before and after', async () => {
    const { result } = renderHook(() => useClusterData(), { wrapper: createQueryWrapper() })
    await flushMicrotasks()
    // Initial load done; refreshing should be false
    expect(result.current.refreshing).toBe(false)

    // Kick off force-refresh
    act(() => { result.current.refresh() })

    // refreshing becomes true immediately after refresh() is called
    expect(result.current.refreshing).toBe(true)

    // Settle all promises
    await flushMicrotasks()

    expect(result.current.refreshing).toBe(false)
  })
})
