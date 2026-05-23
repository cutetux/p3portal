// p3portal.org
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useJobs, useJobLog } from './useJobs'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/jobs', () => ({
  getJobs: vi.fn(),
  getJob: vi.fn(),
  createJobLogSocket: vi.fn(),
}))

import { getJobs, getJob, createJobLogSocket } from '../api/jobs'

const MOCK_JOBS = [
  { id: 'abc-1', type: 'ansible', playbook: 'pb_prox-new-vm', status: 'success', created_at: '2026-04-25T10:00:00Z', username: 'user@pam', params: {} },
  { id: 'abc-2', type: 'ansible', playbook: 'pb_update', status: 'running', created_at: '2026-04-25T11:00:00Z', username: 'user@pam', params: {} },
]

function makeWsMock() {
  const ws = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    close: vi.fn(),
    send: vi.fn(),
    fire(event, data) {
      if (this[`on${event}`]) this[`on${event}`](data)
    },
  }
  return ws
}

describe('useJobs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state and resolves to jobs list', async () => {
    getJobs.mockResolvedValue(MOCK_JOBS)
    const { result } = renderHook(() => useJobs(), { wrapper: createQueryWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.jobs).toEqual(MOCK_JOBS)
    expect(result.current.error).toBeNull()
  })

  it('handles fetch error and sets error state', async () => {
    const err = new Error('Backend nicht erreichbar')
    getJobs.mockRejectedValue(err)
    const { result } = renderHook(() => useJobs(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.jobs).toEqual([])
  })

  it('refresh re-fetches the job list', async () => {
    getJobs.mockResolvedValueOnce(MOCK_JOBS).mockResolvedValueOnce([MOCK_JOBS[0]])
    const { result } = renderHook(() => useJobs(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(() => result.current.refresh())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(getJobs).toHaveBeenCalledTimes(2)
    expect(result.current.jobs).toEqual([MOCK_JOBS[0]])
  })
})

describe('useJobLog', () => {
  beforeEach(() => vi.clearAllMocks())

  it('connects WebSocket and sets connected=true on open', async () => {
    const ws = makeWsMock()
    createJobLogSocket.mockReturnValue(ws)
    getJob.mockResolvedValue({ status: 'running' })

    const { result } = renderHook(() => useJobLog('abc-1'), { wrapper: createQueryWrapper() })

    await act(() => ws.fire('open', {}))
    expect(result.current.connected).toBe(true)
  })

  it('does not create WebSocket when jobId is falsy', () => {
    const { result } = renderHook(() => useJobLog(null), { wrapper: createQueryWrapper() })
    expect(result.current.lines).toEqual([])
    expect(result.current.connected).toBe(false)
    expect(createJobLogSocket).not.toHaveBeenCalled()
  })

  it('sets connected=false on WebSocket error and close', async () => {
    const ws = makeWsMock()
    createJobLogSocket.mockReturnValue(ws)
    getJob.mockResolvedValue({ status: 'pending' })

    const { result } = renderHook(() => useJobLog('abc-1'), { wrapper: createQueryWrapper() })
    await act(() => ws.fire('open', {}))
    expect(result.current.connected).toBe(true)

    await act(() => ws.fire('error', {}))
    expect(result.current.connected).toBe(false)
  })

  it('closes WebSocket on unmount', async () => {
    const ws = makeWsMock()
    createJobLogSocket.mockReturnValue(ws)
    getJob.mockResolvedValue({ status: 'pending' })

    const { unmount } = renderHook(() => useJobLog('abc-1'), { wrapper: createQueryWrapper() })
    unmount()
    expect(ws.close).toHaveBeenCalled()
  })

  it('seeds initial status from getJob', async () => {
    const ws = makeWsMock()
    createJobLogSocket.mockReturnValue(ws)
    getJob.mockResolvedValue({ status: 'success' })

    const { result } = renderHook(() => useJobLog('abc-1'), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))
  })

  it('appends plain-text log line to lines', async () => {
    const ws = makeWsMock()
    createJobLogSocket.mockReturnValue(ws)
    getJob.mockResolvedValue({ status: 'running' })

    const { result } = renderHook(() => useJobLog('abc-1'), { wrapper: createQueryWrapper() })
    await act(() => ws.fire('message', { data: 'TASK [Gathering Facts]' }))
    expect(result.current.lines).toEqual(['TASK [Gathering Facts]'])
  })

  it('updates status from [status] message without adding to lines', async () => {
    const ws = makeWsMock()
    createJobLogSocket.mockReturnValue(ws)
    getJob.mockResolvedValue({ status: 'running' })

    const { result } = renderHook(() => useJobLog('abc-1'), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.status).toBe('running'))

    await act(() => ws.fire('message', { data: '[status] success' }))
    expect(result.current.status).toBe('success')
    expect(result.current.lines).toEqual([])
  })
})
