// p3portal.org
import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { BUILTIN_THEMES, ThemeProvider, useTheme } from './useTheme'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((k) => store[k] ?? null),
    setItem: vi.fn((k, v) => { store[k] = v }),
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('BUILTIN_THEMES', () => {
  it('contains exactly 5 built-in themes', () => {
    expect(BUILTIN_THEMES).toHaveLength(5)
  })

  it('includes dark, p3orange, light and hc', () => {
    const ids = BUILTIN_THEMES.map(t => t.id)
    expect(ids).toContain('dark')
    expect(ids).toContain('p3orange')
    expect(ids).toContain('light')
    expect(ids).toContain('hc')
  })

  it('every theme has all 19 required CSS variables', () => {
    const REQUIRED = [
      '--sidebar', '--bg', '--bg2', '--bg3',
      '--border', '--border2',
      '--text', '--text2', '--text3', '--white',
      '--accent', '--green', '--orange', '--blue', '--purple', '--red',
      '--font', '--radius-card', '--radius-btn',
    ]
    for (const theme of BUILTIN_THEMES) {
      for (const key of REQUIRED) {
        expect(theme.vars).toHaveProperty(key, expect.any(String))
      }
    }
  })

  it('all themes are marked is_builtin: true', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.is_builtin).toBe(true)
    }
  })

  it('p3orange uses correct orange accent color', () => {
    const p3 = BUILTIN_THEMES.find(t => t.id === 'p3orange')
    expect(p3.vars['--accent']).toBe('#e07b39')
  })
})

describe('ThemeProvider / useTheme', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.getItem.mockImplementation(() => null)
    // Reset CSS vars on document
    document.documentElement.style.cssText = ''
    document.documentElement.classList.remove('dark')
  })

  function renderWithProvider() {
    return renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    })
  }

  it('defaults to p3orange theme when no localStorage value', () => {
    const { result } = renderWithProvider()
    expect(result.current.theme).toBe('p3orange')
  })

  it('reads initial theme from localStorage', () => {
    localStorageMock.getItem.mockImplementation((k) => k === 'p3-theme' ? 'light' : null)
    const { result } = renderWithProvider()
    expect(result.current.theme).toBe('light')
  })

  it('setTheme updates theme state', () => {
    const { result } = renderWithProvider()
    act(() => result.current.setTheme('p3orange'))
    expect(result.current.theme).toBe('p3orange')
  })

  it('setTheme persists to localStorage', () => {
    const { result } = renderWithProvider()
    act(() => result.current.setTheme('light'))
    expect(localStorageMock.setItem).toHaveBeenCalledWith('p3-theme', 'light')
  })

  it('dark theme sets html.dark class', () => {
    const { result } = renderWithProvider()
    act(() => result.current.setTheme('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('light theme removes html.dark class', () => {
    const { result } = renderWithProvider()
    act(() => result.current.setTheme('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('p3orange theme sets html.dark class', () => {
    const { result } = renderWithProvider()
    act(() => result.current.setTheme('p3orange'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('hc theme sets html.dark class', () => {
    const { result } = renderWithProvider()
    act(() => result.current.setTheme('hc'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('applyCustomTheme applies vars for unknown theme id', () => {
    const { result } = renderWithProvider()
    const customVars = { '--accent': '#ff00ff' }
    act(() => result.current.applyCustomTheme('corp-theme', customVars))
    expect(result.current.theme).toBe('corp-theme')
    const accent = document.documentElement.style.getPropertyValue('--accent')
    expect(accent).toBe('#ff00ff')
  })

  it('BUILTIN_THEMES is exposed via context', () => {
    const { result } = renderWithProvider()
    expect(result.current.BUILTIN_THEMES).toHaveLength(5)
  })
})
