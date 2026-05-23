// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * PROJ-43: Plus-Komponenten-Registry
 *
 * Frontend-Pendant zum Backend-Hook-Proxy: alle Plus-Komponenten leben in
 * Unterverzeichnissen dieses Moduls und werden hier zentral via React.lazy
 * registriert. Core-Komponenten importieren nur aus dieser Registry und
 * rendern Plus-Inhalte nur wenn der Lizenzstatus es erlaubt.
 *
 * Verwendung in Core-Komponenten:
 *
 *   import { Suspense } from 'react'
 *   import { PlusComponents } from '../../plus'
 *
 *   const ThemeEditor = PlusComponents.ThemeEditor
 *
 *   return isPlus && ThemeEditor ? (
 *     <Suspense fallback={null}>
 *       <ThemeEditor ... />
 *     </Suspense>
 *   ) : null
 *
 * Die Lazy-Chunks werden erst geladen, wenn die Komponente tatsächlich
 * gerendert wird – Core-Nutzer ziehen den Plus-Code nie nach.
 */
import { lazy } from 'react'

export const PlusComponents = {
  // Session 6: Theme-Editor (PROJ-19) als erste Plus-Komponente migriert.
  ThemeEditor: lazy(() => import('./ThemeEditor/ThemeEditorModal')),
  // Session 7: Alert-Presets (PROJ-34) als zweite Plus-Komponente migriert.
  AlertPresetsTab: lazy(() => import('./AlertPresets/AlertPresetsTab')),
  // Session 8: Alert-SMTP (PROJ-34) als dritte Plus-Komponente migriert.
  AlertSmtpSection: lazy(() => import('./AlertSmtp/AlertSmtpSection')),
  // Session 9: Compute-Nodes-Plus-Tabs (PROJ-40) – Alerting + Scheduled Jobs.
  ComputeAlertingTab: lazy(() => import('./ComputeNodes/ComputeAlertingTab')),
  ComputeScheduledJobsTab: lazy(() => import('./ComputeNodes/ComputeScheduledJobsTab')),
  // Session 10: Multi-Node-Verwaltung (PROJ-30) – AddNodeCard.
  // NodeFormModal wurde in components/admin/ verschoben (Core + Plus).
  AddNodeCard: lazy(() => import('./Nodes/AddNodeCard')),
  // Session 11: Themes-Plus-Aktionen (PROJ-19) – Upload + Create-Buttons.
  ThemesAdminActions: lazy(() => import('./Themes/ThemesAdminActions')),
  // Session 12: Scheduled-Jobs-Familie (PROJ-35) – Tabelle, Form-Modal,
  // Detail-Modal, Settings-Sektion. Sub-Komponenten (CronPicker,
  // SshJobForm, PowerActionJobForm, RunHistoryList) werden intern
  // referenziert und müssen daher nicht in die Registry.
  ScheduledJobsTable: lazy(() => import('./ScheduledJobs/ScheduledJobsTable')),
  ScheduledJobFormModal: lazy(() => import('./ScheduledJobs/ScheduledJobFormModal')),
  ScheduledJobDetailModal: lazy(() => import('./ScheduledJobs/ScheduledJobDetailModal')),
  ScheduledJobsSettingsSection: lazy(() => import('./ScheduledJobs/ScheduledJobsSettingsSection')),
  // Session 13: Themes-Row-Edit-Button (PROJ-19) – Plus-only Edit pro
  // Theme-Zeile in ThemesTab. Komplettiert die Themes-Familie zusammen
  // mit ThemeEditor (S6) und ThemesAdminActions (S11).
  ThemeRowEditButton: lazy(() => import('./Themes/ThemeRowEditButton')),
  // Session 14: Languages-Plus-Aktionen (PROJ-18) – Sprach-Upload-Button
  // für eigene .yml/.yaml-Dateien. Pattern identisch zu ThemesAdminActions.
  LanguagesAdminActions: lazy(() => import('./Languages/LanguagesAdminActions')),
  // Session 15: Node-Row-Plus-Aktionen (PROJ-30/26) – "Standard setzen" und
  // Lösch-Button mit Inline-Confirm pro Zeile in der Admin-NodeTable.
  // Komplettiert die Nodes-Familie zusammen mit AddNodeCard (S10).
  NodeSetDefaultButton: lazy(() => import('./Nodes/NodeSetDefaultButton')),
  NodeDeleteButton: lazy(() => import('./Nodes/NodeDeleteButton')),
  // Session 16: User-Form-Plus-Felder (PROJ-24) – Plus-only Max-API-Keys-
  // Input pro Nutzer in der Admin-UserForm-API-Key-Sektion. ApiKeysTab
  // (Profil) bleibt inline, da seine Plus-Branches reine Text-Varianten
  // innerhalb core-sichtbarer Labels sind (keine isolierbaren UI-Blöcke).
  ApiKeyMaxCountField: lazy(() => import('./UserForm/ApiKeyMaxCountField')),
  // Session 17: VM/LXC-Alerts-Preset-Zuweisung (PROJ-34) – Plus-only
  // Section in VmAlertsTab. Effektive + VM-spezifische Regeln bleiben
  // core-sichtbar (admin-only); nur die Preset-Zuweisung ist Plus.
  VmAlertPresetSection: lazy(() => import('./VmAlerts/VmAlertPresetSection')),
  // PROJ-62: Pools (PROJ-46) nach plus/Pools/ migriert – Plus-Modul.
  // PoolsPage: Admin-Übersicht (System Settings → Pools-Tab).
  // PoolsTab: Nutzer-Ansicht "Meine Pools" (MyAccountPage).
  // PoolSelectorField: Dropdown „In Pool deployen" in PlaybookForm (Core).
  // QuotaErrorBanner: Strukturiertes 412-Fehler-Banner in PlaybookForm.
  PoolsPage: lazy(() => import('./Pools/Page')),
  PoolsTab: lazy(() => import('./Pools/components/PoolsTab')),
  PoolSelectorField: lazy(() => import('./Pools/components/PoolSelectorField')),
  QuotaErrorBanner: lazy(() => import('./Pools/QuotaErrorBanner')),
  // PROJ-63: Playbook-Rechte (PROJ-49) nach plus/PlaybookPermissions/ migriert.
  // PlaybookPermissionsPage: Admin-Übersicht (System Settings → Nutzer & Rechte → Playbook-Rechte Sub-Tab).
  // PlaybookPermissionsTab: eingebettete Tab-Variante (wiederverwendet Page mit embedded-Prop).
  // AllowedPlaybooksSection: Nutzer-Profil-Sektion „Erlaubte Playbooks" (PermissionsPage).
  PlaybookPermissionsPage: lazy(() => import('./PlaybookPermissions/Page')),
  PlaybookPermissionsTab: lazy(() => import('./PlaybookPermissions/Page')),
  AllowedPlaybooksSection: lazy(() => import('./PlaybookPermissions/components/AllowedPlaybooksSection')),
  // PROJ-64: Approval-Workflow (PROJ-50) nach plus/Approvals/ migriert.
  // ApprovalsPage: Approver-Sicht (Route /approvals).
  // ApprovalPendingPage: Antrags-Detail (Route /approvals/pending/:id).
  // MyApprovalsTab: Antragsteller-Sicht in MyAccountPage.
  // ApprovalRulesAdminPage: Admin-Übersicht (System Settings → Portal → Approval-Workflow).
  // MasterToggleSection: Aktivierung/Deaktivierung des Approval-Workflows.
  // UseApprovalCountHost: EC-10-konformer Render-Prop-Host für useApprovalCount.
  ApprovalsPage: lazy(() => import('./Approvals/Page')),
  ApprovalPendingPage: lazy(() => import('./Approvals/components/ApprovalPendingPage')),
  MyApprovalsTab: lazy(() => import('./Approvals/components/MyApprovalsTab')),
  ApprovalRulesAdminPage: lazy(() => import('./Approvals/components/ApprovalRulesAdminPage')),
  MasterToggleSection: lazy(() => import('./Approvals/components/MasterToggleSection')),
  UseApprovalCountHost: lazy(() => import('./Approvals/UseApprovalCountHost')),
  // PROJ-68: Git-Sync für Playbooks & Packer-Templates (Plus-only).
  // GitSyncSection: Admin-Sektion in System Settings > Vorlagen.
  GitSyncSection: lazy(() => import('./GitSync/GitSyncSection')),
}

// PROJ-68: Conflict-Badge Hook – non-lazy export (Hook, keine Komponente).
export { useGitSyncConflictIds } from './GitSync/useGitSyncConflictIds'
