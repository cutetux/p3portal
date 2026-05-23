// p3portal.org
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useLanguages } from './useLanguages'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/translations', () => ({
  getLanguages: vi.fn(),
}))

import { getLanguages } from '../api/translations'

const BUILTIN_LANGUAGES = [
  { code: 'de', name: 'Deutsch', is_builtin: true },
  { code: 'en', name: 'English', is_builtin: true },
]

const MOCK_LANGUAGES = [
  ...BUILTIN_LANGUAGES,
  { code: 'fr', name: 'Français', is_builtin: false },
]

describe('useLanguages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with built-in languages as placeholder', async () => {
    getLanguages.mockResolvedValue(MOCK_LANGUAGES)
    const { result } = renderHook(() => useLanguages(), { wrapper: createQueryWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.languages).toEqual(MOCK_LANGUAGES)
  })

  it('falls back to DE/EN on API error', async () => {
    getLanguages.mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useLanguages(), { wrapper: createQueryWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.languages).toEqual(BUILTIN_LANGUAGES)
    expect(result.current.languages).toHaveLength(2)
  })

  it('reload re-fetches languages', async () => {
    getLanguages
      .mockResolvedValueOnce(MOCK_LANGUAGES)
      .mockResolvedValueOnce(BUILTIN_LANGUAGES)
    const { result } = renderHook(() => useLanguages(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.languages).toHaveLength(3)

    await act(() => result.current.reload())
    await waitFor(() => expect(result.current.languages).toHaveLength(2))
  })

  it('always includes German and English in fallback', async () => {
    getLanguages.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useLanguages(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const codes = result.current.languages.map(l => l.code)
    expect(codes).toContain('de')
    expect(codes).toContain('en')
  })
})
