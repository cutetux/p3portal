// p3portal.org
// Globalen Mock aus test-setup.js aufheben – dieser Test prüft die echte Implementierung
vi.unmock('./useCapability')

import { renderHook, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useCapability, useCapabilities } from './useCapability'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/capabilities', () => ({
  fetchCapabilities: vi.fn(),
}))

import { fetchCapabilities } from '../api/capabilities'

const CORE_CAPS = {
  alert_presets: false,
  theme_editor: false,
  multiple_nodes: false,
  scheduled_jobs: false,
}

const PLUS_CAPS = {
  alert_presets: true,
  theme_editor: true,
  multiple_nodes: true,
  scheduled_jobs: true,
}

describe('useCapabilities', () => {
  beforeEach(() => vi.clearAllMocks())

  it('liefert leeres Objekt solange Daten laden', () => {
    fetchCapabilities.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useCapabilities(), { wrapper: createQueryWrapper() })
    expect(result.current).toEqual({})
  })

  it('liefert Core-Defaults (alle false) für Core-Edition', async () => {
    fetchCapabilities.mockResolvedValue(CORE_CAPS)
    const { result } = renderHook(() => useCapabilities(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current).toEqual(CORE_CAPS))
  })

  it('liefert Plus-Werte für Plus-Edition', async () => {
    fetchCapabilities.mockResolvedValue(PLUS_CAPS)
    const { result } = renderHook(() => useCapabilities(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current).toEqual(PLUS_CAPS))
  })
})

describe('useCapability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('gibt false zurück wenn Capability nicht vorhanden', async () => {
    fetchCapabilities.mockResolvedValue({})
    const { result } = renderHook(() => useCapability('theme_editor'), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('gibt false zurück für Core-Edition', async () => {
    fetchCapabilities.mockResolvedValue(CORE_CAPS)
    const { result } = renderHook(() => useCapability('alert_presets'), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('gibt true zurück für Plus-Edition', async () => {
    fetchCapabilities.mockResolvedValue(PLUS_CAPS)
    const { result } = renderHook(() => useCapability('theme_editor'), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('gibt false zurück für unbekannte Capability', async () => {
    fetchCapabilities.mockResolvedValue(PLUS_CAPS)
    const { result } = renderHook(() => useCapability('unknown_capability'), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current).toBe(false))
  })
})
