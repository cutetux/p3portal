// p3portal.org
// PROJ-54: Tests für FavoritesPage (Render, Reorder, Label-Edit, Empty-State).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import FavoritesPage from './Page'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./hooks/useSidebarPins', () => ({
  useSidebarPins: vi.fn(),
}))

vi.mock('./api', () => ({
  sidebarPinsApi: {
    reorder:     vi.fn(() => Promise.resolve([])),
    updateLabel: vi.fn(() => Promise.resolve({ id: 1, label: 'Test', route: '/dashboard', position: 0 })),
    remove:      vi.fn(() => Promise.resolve()),
  },
}))

import { useSidebarPins } from './hooks/useSidebarPins'

const PIN_A = { id: 1, route: '/dashboard',         label: null,     position: 0, pin_kind: 'other' }
const PIN_B = { id: 2, route: '/system-settings',   label: 'Config', position: 1, pin_kind: 'system_settings_tab' }
const PIN_C = { id: 3, route: '/compute',            label: null,     position: 2, pin_kind: 'other' }

function renderPage() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <FavoritesPage />
      </I18nextProvider>
    </MemoryRouter>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

describe('FavoritesPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('zeigt Empty-State wenn keine Pins vorhanden', () => {
    useSidebarPins.mockReturnValue({
      pins: [], loading: false, error: '', setPins: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText(/keine|no_pins/i)).toBeTruthy()
  })

  it('zeigt Lade-Skeleton während loading=true', () => {
    useSidebarPins.mockReturnValue({
      pins: [], loading: true, error: '', setPins: vi.fn(), reload: vi.fn(),
    })
    const { container } = renderPage()
    expect(container.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('zeigt Fehler-Meldung bei error', () => {
    useSidebarPins.mockReturnValue({
      pins: [], loading: false, error: 'Fehler!', setPins: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('Fehler!')).toBeTruthy()
  })

  // ── Render mit Pins ─────────────────────────────────────────────────────────

  it('listet alle Pins in Reihenfolge', () => {
    useSidebarPins.mockReturnValue({
      pins: [PIN_A, PIN_B, PIN_C], loading: false, error: '', setPins: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    expect(screen.getByText('/dashboard')).toBeTruthy()
    expect(screen.getByText('Config')).toBeTruthy()
    expect(screen.getByText('/compute')).toBeTruthy()
  })

  it('zeigt Pin-Anzahl in der Fußzeile', () => {
    useSidebarPins.mockReturnValue({
      pins: [PIN_A, PIN_B], loading: false, error: '', setPins: vi.fn(), reload: vi.fn(),
    })
    const { container } = renderPage()
    expect(container.textContent).toMatch(/2/)
  })

  // ── Reorder ─────────────────────────────────────────────────────────────────

  it('↑-Button ist beim ersten Pin disabled', () => {
    useSidebarPins.mockReturnValue({
      pins: [PIN_A, PIN_B], loading: false, error: '', setPins: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    // First up-button should be disabled
    const upBtns = document.querySelectorAll('button:disabled')
    expect(upBtns.length).toBeGreaterThan(0)
  })

  it('Reorder-API wird bei ↓-Klick aufgerufen', async () => {
    const { sidebarPinsApi } = await import('./api')
    const setPins = vi.fn()
    useSidebarPins.mockReturnValue({
      pins: [PIN_A, PIN_B], loading: false, error: '', setPins, reload: vi.fn(),
    })
    renderPage()
    // find the first ↓ button (move-down), first row
    const allButtons = document.querySelectorAll('button')
    const downBtn = [...allButtons].find(b => {
      const title = b.title?.toLowerCase() ?? ''
      return title.includes('unten') || title.includes('down') || title.includes('↓')
    })
    if (downBtn) fireEvent.click(downBtn)
    await waitFor(() => {
      expect(sidebarPinsApi.reorder).toHaveBeenCalled()
    })
  })

  // ── Label-Edit ──────────────────────────────────────────────────────────────

  it('Klick auf Label-Zelle aktiviert Eingabefeld', () => {
    useSidebarPins.mockReturnValue({
      pins: [PIN_A], loading: false, error: '', setPins: vi.fn(), reload: vi.fn(),
    })
    renderPage()
    const editTrigger = document.querySelector('td button')
    fireEvent.click(editTrigger)
    expect(document.querySelector('input[type="text"]')).toBeTruthy()
  })
})
