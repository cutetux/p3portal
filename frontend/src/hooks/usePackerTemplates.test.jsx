// p3portal.org
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { usePackerTemplates } from './usePackerTemplates'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/packer', () => ({
  fetchPackerTemplates: vi.fn(),
}))
vi.mock('../api/jobs', () => ({
  getJobs: vi.fn(),
}))

import { fetchPackerTemplates } from '../api/packer'
import { getJobs } from '../api/jobs'

const MOCK_TEMPLATES = [
  { id: 'debian-13.3', name: 'Debian 13 Template', description: 'Debian template', required_role: 'operator' },
  { id: 'ubuntu-24', name: 'Ubuntu 24 Template', description: 'Ubuntu template', required_role: 'operator' },
]

const MOCK_JOBS = [
  { id: 'j1', type: 'packer', playbook: 'debian-13.3', status: 'running', created_at: '2026-04-27T00:00:00Z', username: 'user', params: {} },
  { id: 'j2', type: 'packer', playbook: 'ubuntu-24', status: 'success', created_at: '2026-04-27T00:00:00Z', username: 'user', params: {} },
  { id: 'j3', type: 'ansible', playbook: 'pb_update', status: 'running', created_at: '2026-04-27T00:00:00Z', username: 'user', params: {} },
]

describe('usePackerTemplates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state and resolves templates', async () => {
    fetchPackerTemplates.mockResolvedValue(MOCK_TEMPLATES)
    getJobs.mockResolvedValue([])
    const { result } = renderHook(() => usePackerTemplates(), { wrapper: createQueryWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.templates).toEqual(MOCK_TEMPLATES)
    expect(result.current.error).toBeNull()
  })

  it('identifies running packer builds by template id', async () => {
    fetchPackerTemplates.mockResolvedValue(MOCK_TEMPLATES)
    getJobs.mockResolvedValue(MOCK_JOBS)
    const { result } = renderHook(() => usePackerTemplates(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.runningBuilds.has('debian-13.3')).toBe(true)
  })

  it('excludes completed and non-packer jobs from runningBuilds', async () => {
    fetchPackerTemplates.mockResolvedValue(MOCK_TEMPLATES)
    getJobs.mockResolvedValue(MOCK_JOBS)
    const { result } = renderHook(() => usePackerTemplates(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    // ubuntu-24 is success (not running), pb_update is ansible (not packer)
    expect(result.current.runningBuilds.has('ubuntu-24')).toBe(false)
    expect(result.current.runningBuilds.has('pb_update')).toBe(false)
    expect(result.current.runningBuilds.size).toBe(1)
  })

  it('returns empty Set when no packer jobs are running', async () => {
    fetchPackerTemplates.mockResolvedValue(MOCK_TEMPLATES)
    getJobs.mockResolvedValue([])
    const { result } = renderHook(() => usePackerTemplates(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.runningBuilds.size).toBe(0)
  })

  it('handles fetch error and sets error state', async () => {
    const err = new Error('Backend nicht erreichbar')
    fetchPackerTemplates.mockRejectedValue(err)
    getJobs.mockResolvedValue([])
    const { result } = renderHook(() => usePackerTemplates(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.templates).toEqual([])
  })

  it('reload re-fetches templates and jobs', async () => {
    fetchPackerTemplates
      .mockResolvedValueOnce(MOCK_TEMPLATES)
      .mockResolvedValueOnce([MOCK_TEMPLATES[0]])
    getJobs.mockResolvedValue([])
    const { result } = renderHook(() => usePackerTemplates(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.templates).toHaveLength(2)

    await act(() => result.current.reload())
    await waitFor(() => expect(result.current.templates).toHaveLength(1))
  })
})
