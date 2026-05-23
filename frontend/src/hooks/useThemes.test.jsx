// p3portal.org
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useThemes } from './useThemes'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/themes', () => ({
  getThemes: vi.fn(),
}))

import { getThemes } from '../api/themes'
import { BUILTIN_THEMES } from './useTheme'

const MOCK_THEMES = [
  { id: 'dark', name: 'Dark', is_builtin: true, vars: { '--accent': '#f97316' } },
  { id: 'custom-1', name: 'Corporate', is_builtin: false, vars: { '--accent': '#0080ff' } },
]

describe('useThemes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with built-in themes as placeholder and loads from API', async () => {
    getThemes.mockResolvedValue(MOCK_THEMES)
    const { result } = renderHook(() => useThemes(), { wrapper: createQueryWrapper() })

    // Immediately shows BUILTIN_THEMES as placeholder
    expect(result.current.themes).toEqual(BUILTIN_THEMES)
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.themes).toEqual(MOCK_THEMES)
  })

  it('falls back to BUILTIN_THEMES silently on API error', async () => {
    getThemes.mockRejectedValue(new Error('Backend offline'))
    const { result } = renderHook(() => useThemes(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.themes).toEqual(BUILTIN_THEMES)
    expect(result.current.error).toBeNull()
  })

  it('reload re-fetches themes', async () => {
    getThemes
      .mockResolvedValueOnce(MOCK_THEMES)
      .mockResolvedValueOnce([MOCK_THEMES[0]])
    const { result } = renderHook(() => useThemes(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.themes).toHaveLength(2)

    await act(() => result.current.reload())
    await waitFor(() => expect(result.current.themes).toHaveLength(1))
  })
})
