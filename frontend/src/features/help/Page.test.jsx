// p3portal.org
// PROJ-57: Tests für die /help-Seite.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HelpPage from './Page'

// Mock Registry und Resolver
vi.mock('./registry', () => ({
  HELP_CATEGORIES: {
    dashboard: { de: 'Dashboard', en: 'Dashboard' },
    modals:    { de: 'Formulare', en: 'Forms' },
  },
  getRegistryByCategory: () => ({
    dashboard: [{ key: 'dashboard', titleDe: 'Dashboard', titleEn: 'Dashboard', category: 'dashboard', order: 1 }],
    modals:    [{ key: 'modal.user_form', titleDe: 'Nutzer-Formular', titleEn: 'User Form', category: 'modals', order: 1 }],
  }),
}))

vi.mock('./helpResolver', () => ({
  resolveHelpContent: ({ key }) =>
    key === 'dashboard'
      ? { content: '# Dashboard\n\nWillkommen.', source: 'repo', languageFallback: false }
      : { content: null, source: 'none', languageFallback: false },
}))

vi.mock('./components/HelpMarkdownView', () => ({
  default: ({ content }) => <div data-testid="markdown">{content}</div>,
  getRepoBundleMap: () => ({}),
}))

vi.mock('./hooks', () => ({
  useHelpOverridesMe:     () => ({ data: [] }),
  useHelpOverridesGlobal: () => ({ data: [] }),
}))

vi.mock('./components/HelpSlideOverContext', () => ({
  useHelpSlideOver: () => ({ open: vi.fn(), isOpen: false, close: vi.fn() }),
}))

vi.mock('./components/HelpButton', () => ({
  default: () => <button aria-label="Hilfe anzeigen" />,
}))

describe('HelpPage', () => {
  it('zeigt Kategorien und Einträge', () => {
    render(<HelpPage />)
    // Kategorie-Heading und Karten-Label können beide "Dashboard" enthalten
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Nutzer-Formular')).toBeInTheDocument()
  })

  it('filtert bei Sucheingabe', () => {
    render(<HelpPage />)
    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'Nutzer' } })
    expect(screen.getByText('Nutzer-Formular')).toBeInTheDocument()
  })

  it('zeigt Empty-State wenn kein Treffer', () => {
    render(<HelpPage />)
    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'xyzxyz_gibt_es_nicht' } })
    // i18n liefert den Key als-is zurück → key enthält "no_results"
    expect(screen.getByText(/no_results/i)).toBeInTheDocument()
  })
})
