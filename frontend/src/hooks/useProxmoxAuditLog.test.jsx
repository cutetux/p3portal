// p3portal.org
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useProxmoxAuditLog } from './useProxmoxAuditLog'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/logs', () => ({
  getProxmoxAuditLog: vi.fn(),
}))

import { getProxmoxAuditLog } from '../api/logs'

const ENTRY = (i = 0) => ({
  timestamp: `2026-05-03T14:22:${String(i).padStart(2, '0')}Z`,
  token: 'portal@pve!admin-token',
  user: '',
  method: 'GET',
  endpoint: `/api2/json/nodes/pve1/qemu/${i}`,
  status: '200',
  body: null,
})

const err = (status) => {
  const e = new Error('Request failed')
  e.response = { status }
  return e
}

describe('useProxmoxAuditLog', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── Initial state ───────────────────────────────────────────────────────────

  it('starts with loading=true, tabVisible=false, entries=[]', () => {
    getProxmoxAuditLog.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.tabVisible).toBe(false)
    expect(result.current.entries).toEqual([])
    expect(result.current.error).toBeNull()
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('sets entries and tabVisible=true on success', async () => {
    const entries = [ENTRY(1), ENTRY(2)]
    getProxmoxAuditLog.mockResolvedValue(entries)

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.entries).toEqual(entries)
    expect(result.current.tabVisible).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('sets tabVisible=true for empty array (audit enabled, log empty)', async () => {
    getProxmoxAuditLog.mockResolvedValue([])

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tabVisible).toBe(true)
    expect(result.current.entries).toEqual([])
  })

  // ── 404 → tab hidden ────────────────────────────────────────────────────────

  it('sets tabVisible=false on 404 (audit not enabled)', async () => {
    getProxmoxAuditLog.mockRejectedValue(err(404))

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tabVisible).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.entries).toEqual([])
  })

  // ── Non-404 errors → tab visible with error ─────────────────────────────────

  it('sets error and tabVisible=true on 500', async () => {
    const e = err(500)
    getProxmoxAuditLog.mockRejectedValue(e)

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tabVisible).toBe(true)
    expect(result.current.error).toBe(e)
  })

  it('sets error and tabVisible=true on 403', async () => {
    const e = err(403)
    getProxmoxAuditLog.mockRejectedValue(e)

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tabVisible).toBe(true)
    expect(result.current.error).toBe(e)
  })

  it('sets error on network error (no response object)', async () => {
    const e = new Error('Network error')
    getProxmoxAuditLog.mockRejectedValue(e)

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tabVisible).toBe(true)
    expect(result.current.error).toBe(e)
  })

  // ── refresh() ───────────────────────────────────────────────────────────────

  it('refresh() re-fetches and updates entries', async () => {
    getProxmoxAuditLog
      .mockResolvedValueOnce([ENTRY(1)])
      .mockResolvedValueOnce([ENTRY(1), ENTRY(2)])

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toHaveLength(1)

    act(() => { result.current.refresh() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.entries).toHaveLength(2)
    expect(getProxmoxAuditLog).toHaveBeenCalledTimes(2)
  })

  it('refresh() sets loading=true while pending', async () => {
    let resolve
    getProxmoxAuditLog
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(new Promise(r => { resolve = r }))

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => { result.current.refresh() })
    await waitFor(() => expect(result.current.loading).toBe(true))

    act(() => { resolve([ENTRY(1)]) })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toHaveLength(1)
  })

  it('refresh() clears previous error on success', async () => {
    getProxmoxAuditLog
      .mockRejectedValueOnce(err(500))
      .mockResolvedValueOnce([ENTRY(1)])

    const { result } = renderHook(() => useProxmoxAuditLog(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).not.toBeNull()

    act(() => { result.current.refresh() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.entries).toHaveLength(1)
  })
})
