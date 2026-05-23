// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import ThemeEditorModal from './ThemeEditorModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))

vi.mock('../../api/themes', () => ({
  createTheme: vi.fn(),
  updateTheme: vi.fn(),
}))

import { createTheme, updateTheme } from '../../api/themes'

const CUSTOM_THEME = {
  id: 'corp-blue',
  name: 'Corporate Blue',
  is_builtin: false,
  vars: {
    '--sidebar': '#001020',
    '--bg': '#001f3f',
    '--bg2': '#002d5a',
    '--bg3': '#003875',
    '--border': '#004080',
    '--border2': '#0050a0',
    '--text': '#c0d8ff',
    '--text2': '#8ab0e0',
    '--text3': '#5080b0',
    '--white': '#e0f0ff',
    '--accent': '#0080ff',
    '--green': '#00cc44',
    '--orange': '#ff8800',
    '--blue': '#3399ff',
    '--purple': '#8866cc',
    '--red': '#ff3333',
    '--radius-card': '12px',
    '--radius-btn': '8px',
  },
}

function renderModal(props = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<ThemeEditorModal onClose={onClose} onSaved={onSaved} {...props} />)
  return { onClose, onSaved }
}

describe('ThemeEditorModal – Speichern-Button Aktivierung', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Speichern-Button ist deaktiviert wenn Name leer', () => {
    renderModal()
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    expect(saveBtn).toBeDisabled()
  })

  it('Speichern-Button wird aktiv sobald Name eingegeben', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    await act(() => fireEvent.change(input, { target: { value: 'Mein Theme' } }))
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    expect(saveBtn).not.toBeDisabled()
  })

  it('Speichern-Button bleibt deaktiviert bei Leerzeichen-Name', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    await act(() => fireEvent.change(input, { target: { value: '   ' } }))
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    expect(saveBtn).toBeDisabled()
  })
})

describe('ThemeEditorModal – Modus-Toggle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Standard-Modus ist Color-Picker (zeigt Farbwähler)', () => {
    renderModal()
    const colorInputs = document.querySelectorAll('input[type="color"]')
    expect(colorInputs.length).toBeGreaterThan(0)
  })

  it('Wechsel zu JSON zeigt Textarea', async () => {
    renderModal()
    const jsonBtn = screen.getByRole('button', { name: 'appearance.editor_mode_json' })
    await act(() => fireEvent.click(jsonBtn))
    const textarea = document.querySelector('textarea')
    expect(textarea).toBeTruthy()
  })

  it('JSON-Textarea enthält gültiges JSON nach Wechsel', async () => {
    renderModal()
    const jsonBtn = screen.getByRole('button', { name: 'appearance.editor_mode_json' })
    await act(() => fireEvent.click(jsonBtn))
    const textarea = document.querySelector('textarea')
    expect(() => JSON.parse(textarea.value)).not.toThrow()
  })

  it('Wechsel zurück zu Farben funktioniert bei gültigem JSON', async () => {
    renderModal()
    const jsonBtn = screen.getByRole('button', { name: 'appearance.editor_mode_json' })
    await act(() => fireEvent.click(jsonBtn))
    const pickerBtn = screen.getByRole('button', { name: 'appearance.editor_mode_picker' })
    await act(() => fireEvent.click(pickerBtn))
    const colorInputs = document.querySelectorAll('input[type="color"]')
    expect(colorInputs.length).toBeGreaterThan(0)
  })

  it('Wechsel zurück zu Farben bei ungültigem JSON zeigt Fehler', async () => {
    renderModal()
    const jsonBtn = screen.getByRole('button', { name: 'appearance.editor_mode_json' })
    await act(() => fireEvent.click(jsonBtn))
    const textarea = document.querySelector('textarea')
    await act(() => fireEvent.change(textarea, { target: { value: '{invalid json' } }))
    const pickerBtn = screen.getByRole('button', { name: 'appearance.editor_mode_picker' })
    await act(() => fireEvent.click(pickerBtn))
    expect(screen.getByText('appearance.editor_invalid_json')).toBeTruthy()
  })
})

describe('ThemeEditorModal – JSON-Modus Validierung', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Speichern-Button deaktiviert bei ungültigem JSON in JSON-Modus', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    await act(() => fireEvent.change(input, { target: { value: 'Test Theme' } }))
    const jsonBtn = screen.getByRole('button', { name: 'appearance.editor_mode_json' })
    await act(() => fireEvent.click(jsonBtn))
    const textarea = document.querySelector('textarea')
    await act(() => fireEvent.change(textarea, { target: { value: '{invalid' } }))
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    expect(saveBtn).toBeDisabled()
  })

  it('Vorschau-Button zeigt Fehler bei ungültigem JSON', async () => {
    renderModal()
    const jsonBtn = screen.getByRole('button', { name: 'appearance.editor_mode_json' })
    await act(() => fireEvent.click(jsonBtn))
    const textarea = document.querySelector('textarea')
    await act(() => fireEvent.change(textarea, { target: { value: 'invalid' } }))
    const previewBtn = screen.getByRole('button', { name: 'appearance.editor_apply_preview' })
    await act(() => fireEvent.click(previewBtn))
    expect(screen.getByText('appearance.editor_invalid_json')).toBeTruthy()
  })
})

describe('ThemeEditorModal – Abbrechen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Abbrechen-Button ruft onClose auf', async () => {
    const { onClose } = renderModal()
    const cancelBtn = screen.getByRole('button', { name: 'appearance.cancel' })
    await act(() => fireEvent.click(cancelBtn))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ESC-Taste ruft onClose auf', async () => {
    const { onClose } = renderModal()
    await act(() => fireEvent.keyDown(document, { key: 'Escape' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('ThemeEditorModal – Speichern (Neues Theme)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('createTheme wird mit Name und Vars aufgerufen', async () => {
    createTheme.mockResolvedValue({ id: 'my-theme', name: 'My Theme', is_builtin: false, vars: {} })
    const { onClose, onSaved } = renderModal()
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    await act(() => fireEvent.change(input, { target: { value: 'My Theme' } }))
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    await act(() => fireEvent.click(saveBtn))
    await waitFor(() => expect(createTheme).toHaveBeenCalledOnce())
    const [name, vars] = createTheme.mock.calls[0]
    expect(name).toBe('My Theme')
    expect(vars).toHaveProperty('--accent')
    expect(onSaved).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('409-Fehler zeigt "Name bereits vergeben"', async () => {
    const err = { response: { status: 409 } }
    createTheme.mockRejectedValue(err)
    renderModal()
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    await act(() => fireEvent.change(input, { target: { value: 'Dupe Theme' } }))
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    await act(() => fireEvent.click(saveBtn))
    await waitFor(() => expect(screen.getByText('appearance.editor_name_taken')).toBeTruthy())
  })

  it('401-Fehler zeigt "Session abgelaufen"', async () => {
    const err = { response: { status: 401 } }
    createTheme.mockRejectedValue(err)
    renderModal()
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    await act(() => fireEvent.change(input, { target: { value: 'Session Test' } }))
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    await act(() => fireEvent.click(saveBtn))
    await waitFor(() => expect(screen.getByText('appearance.editor_session_expired')).toBeTruthy())
  })
})

describe('ThemeEditorModal – Bearbeiten (Edit-Modus)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Edit-Modus: Name aus editTheme vorgeladen', () => {
    renderModal({ editTheme: CUSTOM_THEME })
    const input = screen.getByPlaceholderText('appearance.editor_name_placeholder')
    expect(input.value).toBe('Corporate Blue')
  })

  it('Edit-Modus: updateTheme statt createTheme wird aufgerufen', async () => {
    updateTheme.mockResolvedValue({ ...CUSTOM_THEME, name: 'Corporate Blue' })
    const { onClose, onSaved } = renderModal({ editTheme: CUSTOM_THEME })
    const saveBtn = screen.getByRole('button', { name: 'appearance.save' })
    await act(() => fireEvent.click(saveBtn))
    await waitFor(() => expect(updateTheme).toHaveBeenCalledOnce())
    expect(updateTheme.mock.calls[0][0]).toBe('corp-blue')
    expect(createTheme).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('Edit-Modus: Farben aus editTheme werden korrekt geladen', () => {
    renderModal({ editTheme: CUSTOM_THEME })
    const accentPicker = document.querySelector('input[type="color"][value="#0080ff"]')
    expect(accentPicker).toBeTruthy()
  })
})
