// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Vitest-Tests für PlaybookPermissionsPage.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (opts) {
        return Object.entries(opts).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), k)
      }
      return k
    },
  }),
}))

vi.mock('../../hooks/usePlaybooks', () => ({
  usePlaybooks: vi.fn(),
}))

vi.mock('./hooks', () => ({
  usePlaybookPermissionsConfig: vi.fn(),
}))

vi.mock('./api', () => ({
  playbookPermissionsApi: {
    listPermissions: vi.fn(() => Promise.resolve([])),
  },
}))

import PlaybookPermissionsPage from './Page'
import { usePlaybooks } from '../../hooks/usePlaybooks'
import { usePlaybookPermissionsConfig } from './hooks'

function makePlaybooks(overrides = []) {
  return overrides.length
    ? overrides
    : [
        { id: 'pb1', name: 'vm_deploy.yml', description: 'Deploy VM', category: 'vm_deployment', can_execute: true },
        { id: 'pb2', name: 'vm_destroy.yml', description: 'Destroy VM', category: 'vm_deployment', can_execute: true },
      ]
}

function makeConfig(mode = 'open') {
  return {
    config: { default_playbook_mode: mode },
    loading: false,
    error: null,
    updateConfig: { mutateAsync: vi.fn(), isPending: false },
  }
}

describe('PlaybookPermissionsPage', () => {
  beforeEach(() => {
    usePlaybooks.mockReturnValue({
      playbooks: makePlaybooks(),
      loading: false,
      error: null,
      reload: vi.fn(),
    })
    usePlaybookPermissionsConfig.mockReturnValue(makeConfig('open'))
  })

  it('rendert die Seitenüberschrift', () => {
    render(<PlaybookPermissionsPage />)
    expect(screen.getByText('playbook_permissions.page_title')).toBeTruthy()
  })

  it('zeigt die Tabellen-Überschrift an', () => {
    render(<PlaybookPermissionsPage />)
    expect(screen.getByText('playbook_permissions.table_heading')).toBeTruthy()
  })

  it('zeigt Playbook-Namen in der Tabelle', () => {
    render(<PlaybookPermissionsPage />)
    expect(screen.getByText('vm_deploy.yml')).toBeTruthy()
    expect(screen.getByText('vm_destroy.yml')).toBeTruthy()
  })

  it('zeigt Loading-Skeleton wenn Playbooks laden', () => {
    usePlaybooks.mockReturnValue({ playbooks: [], loading: true, error: null, reload: vi.fn() })
    render(<PlaybookPermissionsPage />)
    // Skeleton-Elemente sind animate-pulse Divs
    const pulses = document.querySelectorAll('.animate-pulse')
    expect(pulses.length).toBeGreaterThan(0)
  })

  it('zeigt leeren Zustand wenn keine Playbooks', () => {
    usePlaybooks.mockReturnValue({ playbooks: [], loading: false, error: null, reload: vi.fn() })
    render(<PlaybookPermissionsPage />)
    expect(screen.getByText('playbook_permissions.no_playbooks')).toBeTruthy()
  })

  it('zeigt embedded ohne Header wenn embedded=true', () => {
    render(<PlaybookPermissionsPage embedded />)
    const header = document.querySelector('header')
    expect(header).toBeNull()
  })

  it('zeigt DefaultModeSwitch wenn config geladen', () => {
    render(<PlaybookPermissionsPage />)
    expect(screen.getByText('playbook_permissions.default_mode_label')).toBeTruthy()
  })

  it('zeigt restricted Status-Badge bei restricted Modus', () => {
    usePlaybookPermissionsConfig.mockReturnValue(makeConfig('restricted'))
    render(<PlaybookPermissionsPage />)
    expect(screen.getAllByText('playbook_permissions.mode_restricted').length).toBeGreaterThan(0)
  })
})
