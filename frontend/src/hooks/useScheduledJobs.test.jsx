// p3portal.org
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useScheduledJobs, useScheduledJobRuns } from './useScheduledJobs'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/scheduledJobs', () => ({
  listScheduledJobs: vi.fn(),
  getScheduledJobRuns: vi.fn(),
}))

import { listScheduledJobs, getScheduledJobRuns } from '../api/scheduledJobs'

const MOCK_JOB = {
  id: 1,
  name: 'Täglicher SSH-Check',
  description: 'Prüft apt upgrades',
  job_type: 'ssh',
  cron_expression: '0 8 * * *',
  active: true,
  config: { user_host: 'root@192.168.1.10', command: 'apt list --upgradable', ssh_key_source: 'system', timeout: 30 },
  created_by: 'admin',
  created_at: '2026-05-06T10:00:00Z',
  updated_at: '2026-05-06T10:00:00Z',
  last_run_at: null,
  last_run_status: null,
  next_run_at: '2026-05-07T08:00:00Z',
  child_job: null,
}

const MOCK_RUN = {
  id: 1,
  job_id: 1,
  started_at: '2026-05-06T08:00:00Z',
  finished_at: '2026-05-06T08:00:05Z',
  exit_code: 0,
  status: 'success',
  stdout: 'Listing... Done',
  stderr: '',
}

describe('useScheduledJobs', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('starts with loading=true and empty jobs list', () => {
    listScheduledJobs.mockResolvedValue([MOCK_JOB])
    const { result } = renderHook(() => useScheduledJobs(), { wrapper: createQueryWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.jobs).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('loads jobs successfully on mount', async () => {
    listScheduledJobs.mockResolvedValue([MOCK_JOB])
    const { result } = renderHook(() => useScheduledJobs(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.jobs).toEqual([MOCK_JOB])
    expect(result.current.error).toBeNull()
  })

  it('sets error on API failure', async () => {
    const err = new Error('Network error')
    listScheduledJobs.mockRejectedValue(err)
    const { result } = renderHook(() => useScheduledJobs(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.jobs).toEqual([])
  })

  it('returns empty array when API returns empty list', async () => {
    listScheduledJobs.mockResolvedValue([])
    const { result } = renderHook(() => useScheduledJobs(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.jobs).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('exposes reload function that re-fetches jobs', async () => {
    listScheduledJobs.mockResolvedValue([MOCK_JOB])
    const { result } = renderHook(() => useScheduledJobs(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listScheduledJobs).toHaveBeenCalledTimes(1)

    const UPDATED_JOB = { ...MOCK_JOB, name: 'Aktualisierter Job' }
    listScheduledJobs.mockResolvedValue([UPDATED_JOB])
    result.current.reload()
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(listScheduledJobs).toHaveBeenCalledTimes(2)
    expect(result.current.jobs[0].name).toBe('Aktualisierter Job')
  })

  it('resets error on successful reload', async () => {
    listScheduledJobs.mockRejectedValueOnce(new Error('First error'))
    const { result } = renderHook(() => useScheduledJobs(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).not.toBeNull()

    listScheduledJobs.mockResolvedValue([MOCK_JOB])
    result.current.reload()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.jobs).toEqual([MOCK_JOB])
  })
})

describe('useScheduledJobRuns', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('starts with loading=true and empty runs list', () => {
    getScheduledJobRuns.mockResolvedValue([MOCK_RUN])
    const { result } = renderHook(() => useScheduledJobRuns(1), { wrapper: createQueryWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.runs).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('loads runs on mount when jobId is provided', async () => {
    getScheduledJobRuns.mockResolvedValue([MOCK_RUN])
    const { result } = renderHook(() => useScheduledJobRuns(1), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.runs).toEqual([MOCK_RUN])
    expect(getScheduledJobRuns).toHaveBeenCalledWith(1)
  })

  it('does not fetch when jobId is null', () => {
    const { result } = renderHook(() => useScheduledJobRuns(null), { wrapper: createQueryWrapper() })
    expect(getScheduledJobRuns).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
  })

  it('does not fetch when jobId is undefined', () => {
    renderHook(() => useScheduledJobRuns(undefined), { wrapper: createQueryWrapper() })
    expect(getScheduledJobRuns).not.toHaveBeenCalled()
  })

  it('sets error on API failure', async () => {
    const err = new Error('Runs fetch failed')
    getScheduledJobRuns.mockRejectedValue(err)
    const { result } = renderHook(() => useScheduledJobRuns(1), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.runs).toEqual([])
  })

  it('returns empty runs array when API returns empty', async () => {
    getScheduledJobRuns.mockResolvedValue([])
    const { result } = renderHook(() => useScheduledJobRuns(1), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.runs).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('re-fetches when jobId changes', async () => {
    getScheduledJobRuns.mockResolvedValue([MOCK_RUN])
    const { result, rerender } = renderHook(({ id }) => useScheduledJobRuns(id), {
      wrapper: createQueryWrapper(),
      initialProps: { id: 1 },
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getScheduledJobRuns).toHaveBeenCalledWith(1)

    const RUN_2 = { ...MOCK_RUN, id: 2, job_id: 2 }
    getScheduledJobRuns.mockResolvedValue([RUN_2])
    rerender({ id: 2 })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getScheduledJobRuns).toHaveBeenCalledWith(2)
    expect(result.current.runs).toEqual([RUN_2])
  })
})
