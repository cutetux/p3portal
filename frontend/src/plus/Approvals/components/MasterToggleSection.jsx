// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Master-Toggle für den Approval-Workflow (Admin, Portal-Tab).
import { useState } from 'react'
import { formatApiError } from '../../../api/errors'
import { useToggleWorkflow, useWorkflowConfig } from '../hooks'
import ConfirmModal from '../../../components/common/ConfirmModal'

export default function MasterToggleSection() {
  const { data: config, isLoading } = useWorkflowConfig()
  const toggleMut = useToggleWorkflow()
  const [confirmEnable, setConfirmEnable] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [error, setError] = useState(null)

  const enabled = config?.enabled ?? false

  async function doToggle(value) {
    setError(null)
    try {
      await toggleMut.mutateAsync({ enabled: value })
    } catch (err) {
      setError(formatApiError(err, 'Umschalten fehlgeschlagen.'))
    }
  }

  if (isLoading) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-portal-white">Approval-Workflow</p>
          <p className="text-xs text-portal-text2 mt-0.5">
            4-Augen-Prinzip für kritische Aktionen (Playbooks, Packer, VM-Löschen …)
          </p>
        </div>
        <button
          onClick={() => enabled ? setConfirmDisable(true) : setConfirmEnable(true)}
          disabled={toggleMut.isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-portal-accent disabled:opacity-50 ${
            enabled ? 'bg-portal-success' : 'bg-portal-bg3'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {error && <p className="text-sm text-portal-danger">{error}</p>}

      {confirmEnable && (
        <ConfirmModal
          title="Approval-Workflow aktivieren?"
          message="Ab sofort werden Aktionen mit Approval-Pflicht nicht mehr sofort ausgeführt, sondern müssen erst genehmigt werden. Aktive Schedules für approval-pflichtige Aktionen werden pausiert."
          confirmLabel="Aktivieren"
          variant="primary"
          onConfirm={() => { setConfirmEnable(false); doToggle(true) }}
          onCancel={() => setConfirmEnable(false)}
        />
      )}

      {confirmDisable && (
        <ConfirmModal
          title="Approval-Workflow deaktivieren?"
          message="Alle offenen Anträge werden storniert. Pausierte Schedules werden reaktiviert und laufen ab dem nächsten Tick wieder normal."
          confirmLabel="Deaktivieren"
          variant="danger"
          onConfirm={() => { setConfirmDisable(false); doToggle(false) }}
          onCancel={() => setConfirmDisable(false)}
        />
      )}
    </div>
  )
}
