// p3portal.org
// PROJ-54: Regressionsschutz – Hook muss setPins liefern (Favoriten-Reorder).
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useSidebarPins } from './useSidebarPins'
import { createQueryWrapper } from '../../../test-utils'

vi.mock('../api', () => ({
  sidebarPinsApi: {
    list: vi.fn(),
  },
}))

import { sidebarPinsApi } from '../api'

const PINS = [
  { id: 1, route: '/dashboard', label: null, position: 0, pin_kind: 'other' },
  { id: 2, route: '/compute',   label: null, position: 1, pin_kind: 'other' },
]

describe('useSidebarPins', () => {
  beforeEach(() => vi.clearAllMocks())

  it('liefert setPins als Funktion (Reorder-Voraussetzung)', async () => {
    sidebarPinsApi.list.mockResolvedValue(PINS)
    const { result } = renderHook(() => useSidebarPins(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(typeof result.current.setPins).toBe('function')
  })

  it('setPins schreibt in den Cache und aktualisiert pins', async () => {
    sidebarPinsApi.list.mockResolvedValue(PINS)
    const { result } = renderHook(() => useSidebarPins(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.pins).toHaveLength(2))

    const reversed = [...PINS].reverse()
    act(() => { result.current.setPins(reversed) })

    await waitFor(() => expect(result.current.pins[0].id).toBe(2))
    expect(result.current.pins[1].id).toBe(1)
  })
})
