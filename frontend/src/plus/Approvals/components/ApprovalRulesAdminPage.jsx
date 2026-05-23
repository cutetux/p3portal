// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Admin-Seite Approval-Workflow (PROJ-58 portal-* Tokens, PROJ-59 embedded-fähig).
import { useApprovalRules, useWorkflowConfig } from '../hooks'
import ApprovalRulesTable from './ApprovalRulesTable'
import MasterToggleSection from './MasterToggleSection'

export default function ApprovalRulesAdminPage({ embedded = false }) {
  const { data: rules = [], isLoading } = useApprovalRules()
  const { data: config } = useWorkflowConfig()

  return (
    <div className={embedded ? 'space-y-6' : 'p-6 space-y-6 max-w-5xl'}>
      {!embedded && (
        <h1 className="text-xl font-bold text-portal-white">Approval-Workflow</h1>
      )}

      {/* Master-Toggle */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-portal-text mb-4">Master-Toggle</h2>
        <MasterToggleSection />
      </div>

      {/* Disabled-Banner wenn Workflow deaktiviert */}
      {config && !config.enabled && (
        <div className="bg-portal-bg3/40 border border-portal-border rounded-lg p-3 flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-portal-text3 shrink-0">
            <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <p className="text-sm text-portal-text2">
            Workflow ist deaktiviert – Regeln können bearbeitet werden, greifen aber erst nach Aktivierung.
          </p>
        </div>
      )}

      {/* Regeln-Tabelle */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <ApprovalRulesTable rules={rules} isLoading={isLoading} readOnly={config ? !config.enabled : false} />
      </div>
    </div>
  )
}
