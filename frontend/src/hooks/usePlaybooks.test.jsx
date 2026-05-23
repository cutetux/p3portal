// p3portal.org
import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { usePlaybooks } from './usePlaybooks'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/playbooks', () => ({
  getPlaybooks: vi.fn(),
}))

import { getPlaybooks } from '../api/playbooks'

const MOCK_PLAYBOOKS = [
  { id: 'pb_prox-new-vm', name: 'VM Provisionieren', description: 'Erstellt eine VM', required_role: 'PVEVMAdmin' },
  { id: 'pb_update', name: 'Update', description: 'Führt Updates durch', required_role: null },
]

describe('usePlaybooks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts in loading state and resolves to playbooks list', async () => {
    getPlaybooks.mockResolvedValue(MOCK_PLAYBOOKS)
    const { result } = renderHook(() => usePlaybooks(), { wrapper: createQueryWrapper() })

    expect(result.current.loading).toBe(true)
    expect(result.current.playbooks).toEqual([])

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.playbooks).toEqual(MOCK_PLAYBOOKS)
    expect(result.current.error).toBeNull()
  })

  it('handles empty playbook list', async () => {
    getPlaybooks.mockResolvedValue([])
    const { result } = renderHook(() => usePlaybooks(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.playbooks).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('captures API errors and clears loading', async () => {
    const err = new Error('Network Error')
    getPlaybooks.mockRejectedValue(err)
    const { result } = renderHook(() => usePlaybooks(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.playbooks).toEqual([])
  })
})
