// p3portal.org
// PROJ-47: Tests für NodeAccessModal.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import NodeAccessModal from './Page'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('./hooks/useNodeAssignments', () => ({
  useNodeAssignments: vi.fn(),
}))

vi.mock('../../api/rbac', () => ({
  fetchPresets: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../api/admin', () => ({
  fetchUsers: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../groups/api', () => ({
  groupsApi: { list: vi.fn(() => Promise.resolve([])) },
}))

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

import { useNodeAssignments } from './hooks/useNodeAssignments'

const MOCK_NODE = { id: 1, name: 'pve-node-1' }

function renderModal({ isPlus = true, onClose = vi.fn() } = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <NodeAccessModal node={MOCK_NODE} isPlus={isPlus} onClose={onClose} />
    </I18nextProvider>
  )
}

describe('NodeAccessModal', () => {
  beforeEach(() => {
    useNodeAssignments.mockReturnValue({
      assignments: [],
      loading: false,
      error: '',
      reload: vi.fn(),
    })
  })

  it('zeigt Modal-Header mit Node-Namen', async () => {
    renderModal()
    await waitFor(() => {
      expect(screen.getByText(/pve-node-1/)).toBeInTheDocument()
    })
  })

  it('zeigt Empty-State wenn keine Zuweisungen', async () => {
    renderModal()
    await waitFor(() => {
      expect(screen.getByText(/node_assignments\.empty_state|keine Zuwei/i)).toBeInTheDocument()
    })
  })

  it('zeigt "Zuweisung hinzufügen"-Button wenn isPlus', async () => {
    renderModal({ isPlus: true })
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /hinzufügen|add/i })
      expect(btn).toBeInTheDocument()
    })
  })

  it('versteckt "Zuweisung hinzufügen"-Button wenn nicht isPlus', async () => {
    renderModal({ isPlus: false })
    await waitFor(() => {
      const buttons = screen.getAllByRole('button')
      const addBtn = buttons.find(b => b.textContent?.match(/hinzufügen/i))
      expect(addBtn).toBeUndefined()
    })
  })

  it('zeigt Core-Downgrade-Banner wenn nicht isPlus und Assignments vorhanden', async () => {
    useNodeAssignments.mockReturnValue({
      assignments: [{
        id: 1, node_id: 1, subject_type: 'user', subject_id: 2,
        subject_display: 'testuser', role_preset_id: 1, preset_name: 'Viewer',
        preset_node_actions: [], added_at: '2026-01-01', added_by: 'admin',
      }],
      loading: false,
      error: '',
      reload: vi.fn(),
    })
    renderModal({ isPlus: false })
    await waitFor(() => {
      expect(screen.getByText(/plus|Core|downgrade/i)).toBeInTheDocument()
    })
  })

  it('zeigt Zuweisungs-Tabelle wenn Assignments vorhanden', async () => {
    useNodeAssignments.mockReturnValue({
      assignments: [{
        id: 1, node_id: 1, subject_type: 'user', subject_id: 2,
        subject_display: 'alice', role_preset_id: 1, preset_name: 'VM Viewer',
        preset_node_actions: ['node:view_tasks'], added_at: '2026-01-01', added_by: 'admin',
      }],
      loading: false,
      error: '',
      reload: vi.fn(),
    })
    renderModal()
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument()
      expect(screen.getByText('VM Viewer')).toBeInTheDocument()
    })
  })

  it('zeigt Lade-State korrekt', () => {
    useNodeAssignments.mockReturnValue({
      assignments: [],
      loading: true,
      error: '',
      reload: vi.fn(),
    })
    renderModal()
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('ruft onClose bei Klick auf Schließen-Button auf', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    await waitFor(() => {
      const closeBtn = screen.getAllByRole('button').find(b => b.title === '' && b.querySelector('svg'))
      expect(closeBtn).toBeDefined()
    })
  })
})
