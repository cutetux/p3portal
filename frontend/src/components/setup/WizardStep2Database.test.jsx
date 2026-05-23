// p3portal.org
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import WizardStep1Database from './WizardStep2Database'
import * as setupApi from '../../api/setup'

vi.mock('../../api/setup', () => ({
  setupDatabase: vi.fn(),
  testDatabaseConnection: vi.fn(),
}))

function renderComponent(props = {}) {
  const onNext = vi.fn()
  const defaults = { initial: {}, onNext, ...props }
  render(<WizardStep1Database {...defaults} />)
  return { onNext }
}

describe('WizardStep1Database', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── SQLite (default) ────────────────────────────────────────────────────────

  it('renders SQLite info box by default', () => {
    renderComponent()
    expect(screen.getByText(/portal\.db/)).toBeTruthy()
    expect(screen.queryByPlaceholderText('192.168.1.10')).toBeNull()
  })

  it('SQLite Weiter calls onNext with db_type sqlite without API call', async () => {
    const { onNext } = renderComponent()
    fireEvent.submit(document.querySelector('form'))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith({ db_type: 'sqlite' }))
    expect(setupApi.setupDatabase).not.toHaveBeenCalled()
  })

  it('does not show Verbindung testen for SQLite', () => {
    renderComponent()
    expect(screen.queryByText('Verbindung testen')).toBeNull()
  })

  // ── BUG-25-1: undefined initial.db_type ────────────────────────────────────

  it('BUG-25-1: undefined initial.db_type does not crash (isPostgres stays false)', () => {
    // When SetupPage passes initial={{ db_type: undefined }}, spreading overrides default.
    // The component should not throw and still show SQLite info box.
    renderComponent({ initial: { db_type: undefined, host: undefined } })
    // isPostgres = undefined === 'postgresql' = false → SQLite UI visible
    expect(screen.getByText(/portal\.db/)).toBeTruthy()
  })

  // ── PostgreSQL ──────────────────────────────────────────────────────────────

  it('clicking PostgreSQL button shows connection fields', () => {
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    expect(screen.getByPlaceholderText('192.168.1.10')).toBeTruthy()
    expect(screen.getByText('Verbindung testen')).toBeTruthy()
  })

  it('shows Datenverlust warning when PostgreSQL selected', () => {
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    expect(screen.getByText(/Portaldaten zurück/)).toBeTruthy()
  })

  it('PostgreSQL validation: whitespace-only host shows error on submit', async () => {
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    // Fill host with space to avoid BUG-25-1 undefined.trim() TypeError
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), { target: { value: ' ' } })
    // Datenbankname is the first p3portal input, Benutzername uses autocomplete="username"
    fireEvent.change(document.querySelector('input[placeholder="p3portal"]:not([autocomplete="username"])'), { target: { value: 'mydb' } })
    fireEvent.change(document.querySelector('input[autocomplete="username"]'), { target: { value: 'user' } })
    fireEvent.change(document.querySelector('input[autocomplete="new-password"]'), { target: { value: 'secret' } })
    fireEvent.submit(document.querySelector('form'))
    await waitFor(() => expect(screen.getByText(/Host darf nicht leer sein/)).toBeTruthy())
  })

  it('PostgreSQL: all fields filled → calls setupDatabase and onNext', async () => {
    setupApi.setupDatabase.mockResolvedValueOnce({ ok: true, db_type: 'postgresql', restart_required: true })
    const { onNext } = renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), { target: { value: 'db.example.com' } })
    fireEvent.change(document.querySelector('input[placeholder="p3portal"]:not([autocomplete="username"])'), { target: { value: 'p3db' } })
    fireEvent.change(document.querySelector('input[autocomplete="username"]'), { target: { value: 'dbuser' } })
    fireEvent.change(document.querySelector('input[autocomplete="new-password"]'), { target: { value: 'securepass' } })
    fireEvent.submit(document.querySelector('form'))
    await waitFor(() => expect(setupApi.setupDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ db_type: 'postgresql', host: 'db.example.com' })
    ))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ db_type: 'postgresql', db_host: 'db.example.com' })
    ))
  })

  it('PostgreSQL: API error shows error message', async () => {
    setupApi.setupDatabase.mockRejectedValueOnce({
      response: { data: { detail: 'Verbindungsfehler' } },
    })
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), { target: { value: 'db.example.com' } })
    fireEvent.change(document.querySelector('input[placeholder="p3portal"]:not([autocomplete="username"])'), { target: { value: 'p3db' } })
    fireEvent.change(document.querySelector('input[autocomplete="username"]'), { target: { value: 'dbuser' } })
    fireEvent.change(document.querySelector('input[autocomplete="new-password"]'), { target: { value: 'securepass' } })
    fireEvent.submit(document.querySelector('form'))
    await waitFor(() => expect(screen.getByText('Verbindungsfehler')).toBeTruthy())
  })

  // ── Connection test ─────────────────────────────────────────────────────────

  it('Verbindung testen: success shows green message', async () => {
    setupApi.testDatabaseConnection.mockResolvedValueOnce({ ok: true, message: 'Verbindung erfolgreich' })
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), { target: { value: 'db.example.com' } })
    fireEvent.change(document.querySelector('input[placeholder="p3portal"]:not([autocomplete="username"])'), { target: { value: 'p3db' } })
    fireEvent.change(document.querySelector('input[autocomplete="username"]'), { target: { value: 'dbuser' } })
    fireEvent.change(document.querySelector('input[autocomplete="new-password"]'), { target: { value: 'securepass' } })
    fireEvent.click(screen.getByRole('button', { name: /Verbindung testen/ }))
    await waitFor(() => expect(screen.getByText(/Verbindung erfolgreich/)).toBeTruthy())
  })

  it('Verbindung testen: failure shows error without credentials', async () => {
    setupApi.testDatabaseConnection.mockRejectedValueOnce({
      response: { data: { detail: 'Verbindung fehlgeschlagen: db.example.com:5432/p3db' } },
    })
    renderComponent()
    fireEvent.click(screen.getByRole('button', { name: /PostgreSQL/ }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), { target: { value: 'db.example.com' } })
    fireEvent.change(document.querySelector('input[placeholder="p3portal"]:not([autocomplete="username"])'), { target: { value: 'p3db' } })
    fireEvent.change(document.querySelector('input[autocomplete="username"]'), { target: { value: 'dbuser' } })
    fireEvent.change(document.querySelector('input[autocomplete="new-password"]'), { target: { value: 'supersecret' } })
    fireEvent.click(screen.getByRole('button', { name: /Verbindung testen/ }))
    await waitFor(() => expect(screen.getByText(/Verbindung fehlgeschlagen/)).toBeTruthy())
    expect(screen.queryByText('supersecret')).toBeNull()
  })
})
