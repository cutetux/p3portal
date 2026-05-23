// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { describe, it, expect } from 'vitest'
import { PlusComponents } from './index'

describe('PlusComponents Registry (PROJ-43)', () => {
  it('registers ThemeEditor as a lazy component', () => {
    expect(PlusComponents.ThemeEditor).toBeTypeOf('object')
    expect(PlusComponents.ThemeEditor.$$typeof).toBeDefined()
  })

  it('registers AlertPresetsTab as a lazy component (Session 7)', () => {
    expect(PlusComponents.AlertPresetsTab).toBeTypeOf('object')
    expect(PlusComponents.AlertPresetsTab.$$typeof).toBeDefined()
  })

  it('registers AlertSmtpSection as a lazy component (Session 8)', () => {
    expect(PlusComponents.AlertSmtpSection).toBeTypeOf('object')
    expect(PlusComponents.AlertSmtpSection.$$typeof).toBeDefined()
  })

  it('registers ComputeAlertingTab as a lazy component (Session 9)', () => {
    expect(PlusComponents.ComputeAlertingTab).toBeTypeOf('object')
    expect(PlusComponents.ComputeAlertingTab.$$typeof).toBeDefined()
  })

  it('registers ComputeScheduledJobsTab as a lazy component (Session 9)', () => {
    expect(PlusComponents.ComputeScheduledJobsTab).toBeTypeOf('object')
    expect(PlusComponents.ComputeScheduledJobsTab.$$typeof).toBeDefined()
  })

  it('registers AddNodeCard as a lazy component (Session 10)', () => {
    expect(PlusComponents.AddNodeCard).toBeTypeOf('object')
    expect(PlusComponents.AddNodeCard.$$typeof).toBeDefined()
  })

  it('NodeFormModal wurde nach components/admin/ verschoben (Core + Plus)', () => {
    expect(PlusComponents.NodeFormModal).toBeUndefined()
  })

  it('registers ThemesAdminActions as a lazy component (Session 11)', () => {
    expect(PlusComponents.ThemesAdminActions).toBeTypeOf('object')
    expect(PlusComponents.ThemesAdminActions.$$typeof).toBeDefined()
  })

  it('registers ScheduledJobsTable as a lazy component (Session 12)', () => {
    expect(PlusComponents.ScheduledJobsTable).toBeTypeOf('object')
    expect(PlusComponents.ScheduledJobsTable.$$typeof).toBeDefined()
  })

  it('registers ScheduledJobFormModal as a lazy component (Session 12)', () => {
    expect(PlusComponents.ScheduledJobFormModal).toBeTypeOf('object')
    expect(PlusComponents.ScheduledJobFormModal.$$typeof).toBeDefined()
  })

  it('registers ScheduledJobDetailModal as a lazy component (Session 12)', () => {
    expect(PlusComponents.ScheduledJobDetailModal).toBeTypeOf('object')
    expect(PlusComponents.ScheduledJobDetailModal.$$typeof).toBeDefined()
  })

  it('registers ScheduledJobsSettingsSection as a lazy component (Session 12)', () => {
    expect(PlusComponents.ScheduledJobsSettingsSection).toBeTypeOf('object')
    expect(PlusComponents.ScheduledJobsSettingsSection.$$typeof).toBeDefined()
  })

  it('registers ThemeRowEditButton as a lazy component (Session 13)', () => {
    expect(PlusComponents.ThemeRowEditButton).toBeTypeOf('object')
    expect(PlusComponents.ThemeRowEditButton.$$typeof).toBeDefined()
  })

  it('registers LanguagesAdminActions as a lazy component (Session 14)', () => {
    expect(PlusComponents.LanguagesAdminActions).toBeTypeOf('object')
    expect(PlusComponents.LanguagesAdminActions.$$typeof).toBeDefined()
  })

  it('registers NodeSetDefaultButton as a lazy component (Session 15)', () => {
    expect(PlusComponents.NodeSetDefaultButton).toBeTypeOf('object')
    expect(PlusComponents.NodeSetDefaultButton.$$typeof).toBeDefined()
  })

  it('registers NodeDeleteButton as a lazy component (Session 15)', () => {
    expect(PlusComponents.NodeDeleteButton).toBeTypeOf('object')
    expect(PlusComponents.NodeDeleteButton.$$typeof).toBeDefined()
  })

  it('registers ApiKeyMaxCountField as a lazy component (Session 16)', () => {
    expect(PlusComponents.ApiKeyMaxCountField).toBeTypeOf('object')
    expect(PlusComponents.ApiKeyMaxCountField.$$typeof).toBeDefined()
  })

  it('registers VmAlertPresetSection as a lazy component (Session 17)', () => {
    expect(PlusComponents.VmAlertPresetSection).toBeTypeOf('object')
    expect(PlusComponents.VmAlertPresetSection.$$typeof).toBeDefined()
  })

  // PROJ-62: Pools-Plus-Migration – 4 neue Registry-Einträge
  it('registers PoolsPage as a lazy component (PROJ-62)', () => {
    expect(PlusComponents.PoolsPage).toBeTypeOf('object')
    expect(PlusComponents.PoolsPage.$$typeof).toBeDefined()
  })

  it('registers PoolsTab as a lazy component (PROJ-62)', () => {
    expect(PlusComponents.PoolsTab).toBeTypeOf('object')
    expect(PlusComponents.PoolsTab.$$typeof).toBeDefined()
  })

  it('registers PoolSelectorField as a lazy component (PROJ-62)', () => {
    expect(PlusComponents.PoolSelectorField).toBeTypeOf('object')
    expect(PlusComponents.PoolSelectorField.$$typeof).toBeDefined()
  })

  it('registers QuotaErrorBanner as a lazy component (PROJ-62)', () => {
    expect(PlusComponents.QuotaErrorBanner).toBeTypeOf('object')
    expect(PlusComponents.QuotaErrorBanner.$$typeof).toBeDefined()
  })

  // PROJ-63: PlaybookPermissions-Plus-Migration – 3 neue Registry-Einträge
  it('registers PlaybookPermissionsPage as a lazy component (PROJ-63)', () => {
    expect(PlusComponents.PlaybookPermissionsPage).toBeTypeOf('object')
    expect(PlusComponents.PlaybookPermissionsPage.$$typeof).toBeDefined()
  })

  it('registers PlaybookPermissionsTab as a lazy component (PROJ-63)', () => {
    expect(PlusComponents.PlaybookPermissionsTab).toBeTypeOf('object')
    expect(PlusComponents.PlaybookPermissionsTab.$$typeof).toBeDefined()
  })

  it('registers AllowedPlaybooksSection as a lazy component (PROJ-63)', () => {
    expect(PlusComponents.AllowedPlaybooksSection).toBeTypeOf('object')
    expect(PlusComponents.AllowedPlaybooksSection.$$typeof).toBeDefined()
  })

  it('registers ApprovalsPage as a lazy component (PROJ-64)', () => {
    expect(PlusComponents.ApprovalsPage).toBeTypeOf('object')
    expect(PlusComponents.ApprovalsPage.$$typeof).toBeDefined()
  })

  it('registers ApprovalPendingPage as a lazy component (PROJ-64)', () => {
    expect(PlusComponents.ApprovalPendingPage).toBeTypeOf('object')
    expect(PlusComponents.ApprovalPendingPage.$$typeof).toBeDefined()
  })

  it('registers MyApprovalsTab as a lazy component (PROJ-64)', () => {
    expect(PlusComponents.MyApprovalsTab).toBeTypeOf('object')
    expect(PlusComponents.MyApprovalsTab.$$typeof).toBeDefined()
  })

  it('registers UseApprovalCountHost as a lazy component (PROJ-64)', () => {
    expect(PlusComponents.UseApprovalCountHost).toBeTypeOf('object')
    expect(PlusComponents.UseApprovalCountHost.$$typeof).toBeDefined()
  })

  // PROJ-68: Git-Sync
  it('registers GitSyncSection as a lazy component (PROJ-68)', () => {
    expect(PlusComponents.GitSyncSection).toBeTypeOf('object')
    expect(PlusComponents.GitSyncSection.$$typeof).toBeDefined()
  })

  it('exposes only the migrated Plus components', () => {
    expect(Object.keys(PlusComponents).sort()).toEqual([
      'AddNodeCard',
      'AlertPresetsTab',
      'AlertSmtpSection',
      'AllowedPlaybooksSection',
      'ApiKeyMaxCountField',
      'ApprovalPendingPage',
      'ApprovalRulesAdminPage',
      'ApprovalsPage',
      'ComputeAlertingTab',
      'ComputeScheduledJobsTab',
      'GitSyncSection',
      'LanguagesAdminActions',
      'MasterToggleSection',
      'MyApprovalsTab',
      'NodeDeleteButton',
      'NodeSetDefaultButton',
      'PlaybookPermissionsPage',
      'PlaybookPermissionsTab',
      'PoolSelectorField',
      'PoolsPage',
      'PoolsTab',
      'QuotaErrorBanner',
      'ScheduledJobDetailModal',
      'ScheduledJobFormModal',
      'ScheduledJobsSettingsSection',
      'ScheduledJobsTable',
      'ThemeEditor',
      'ThemeRowEditButton',
      'ThemesAdminActions',
      'UseApprovalCountHost',
      'VmAlertPresetSection',
    ])
  })
})
