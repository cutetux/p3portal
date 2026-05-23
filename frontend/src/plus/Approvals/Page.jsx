// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Approver-Sicht – Liste aller Anträge, die ich entscheiden kann.
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useCapability } from '../../hooks/useCapability'
import { useApprovalsList } from './hooks'
import ApprovalsTable from './components/ApprovalsTable'

export default function ApprovalsPage() {
  const approvalWorkflowEnabled = useCapability('approval_workflow_enabled')
  const [filterStatus, setFilterStatus]         = useState('')
  const [filterActionType, setFilterActionType] = useState('')
  const { data, isLoading } = useApprovalsList({
    ...(filterStatus     ? { status:      filterStatus     } : {}),
    ...(filterActionType ? { action_type: filterActionType } : {}),
  })

  if (!approvalWorkflowEnabled) {
    return <Navigate to="/dashboard" replace />
  }

  const items = data?.items ?? []
  const total = data?.total ?? 0

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-portal-white">Freigaben</h1>
          {total > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-portal-warn/15 text-portal-warn text-xs font-semibold">
              {total}
            </span>
          )}
        </div>
        <p className="text-sm text-portal-text2">
          Anträge, die du freigeben oder ablehnen kannst.
        </p>

        <div className="bg-portal-bg2 rounded-xl border border-portal-border p-5">
          <ApprovalsTable
            items={items}
            total={total}
            isLoading={isLoading}
            filterStatus={filterStatus}
            filterActionType={filterActionType}
            onFilterChange={(key, val) => key === 'status' ? setFilterStatus(val) : setFilterActionType(val)}
          />
        </div>
      </div>
    </div>
  )
}
