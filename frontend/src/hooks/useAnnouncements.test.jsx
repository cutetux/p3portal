// p3portal.org
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useAnnouncements } from './useAnnouncements'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/announcements', () => ({
  fetchAnnouncements: vi.fn(),
}))

import { fetchAnnouncements } from '../api/announcements'

const MOCK_ANN = [
  { id: 1, message: 'Wartung heute Nacht', type: 'warn', active: true, expires_at: null, created_by: 'admin', created_at: '2026-05-01T10:00:00Z', updated_at: '2026-05-01T10:00:00Z', expired: false },
  { id: 2, message: 'Neues Feature verfügbar', type: 'info', active: true, expires_at: null, created_by: 'admin', created_at: '2026-05-02T10:00:00Z', updated_at: '2026-05-02T10:00:00Z', expired: false },
]

describe('useAnnouncements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with loading=true and empty announcements', () => {
    fetchAnnouncements.mockResolvedValue(MOCK_ANN)
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    expect(result.current.loading).toBe(true)
    expect(result.current.announcements).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('loads announcements on mount', async () => {
    fetchAnnouncements.mockResolvedValue(MOCK_ANN)
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.announcements).toEqual(MOCK_ANN)
    expect(result.current.error).toBeNull()
  })

  it('sets error on fetch failure', async () => {
    const err = new Error('Network error')
    fetchAnnouncements.mockRejectedValue(err)
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.announcements).toEqual([])
  })

  it('returns empty array when API returns empty list', async () => {
    fetchAnnouncements.mockResolvedValue([])
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.announcements).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('exposes reload function', () => {
    fetchAnnouncements.mockResolvedValue([])
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    expect(typeof result.current.reload).toBe('function')
  })

  it('reload re-fetches data', async () => {
    fetchAnnouncements.mockResolvedValueOnce([]).mockResolvedValueOnce(MOCK_ANN)
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.announcements).toEqual([])

    result.current.reload()
    await waitFor(() => expect(result.current.announcements).toEqual(MOCK_ANN))
  })

  it('clears error after successful reload', async () => {
    const err = new Error('fail')
    fetchAnnouncements.mockRejectedValueOnce(err).mockResolvedValueOnce(MOCK_ANN)
    const { result } = renderHook(() => useAnnouncements(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)

    result.current.reload()
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.announcements).toEqual(MOCK_ANN)
  })
})
