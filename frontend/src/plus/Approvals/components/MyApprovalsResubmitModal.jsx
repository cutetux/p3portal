// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Modal zum Neu-Einreichen eines abgelehnten/suspendierten Antrags.
import { useState } from 'react'
import { formatApiError } from '../../../api/errors'
import { useResubmitApproval } from '../hooks'
import ApprovalPayloadView from './ApprovalPayloadView'

/** @param {{ approval: object, onClose: Function }} */
export default function MyApprovalsResubmitModal({ approval, onClose }) {
  const [error, setError] = useState(null)
  const resubmit = useResubmitApproval()

  async function handleResubmit() {
    setError(null)
    try {
      await resubmit.mutateAsync({ id: approval.id, payloadOverrides: {} })
      onClose(true)
    } catch (err) {
      setError(formatApiError(err, 'Neueinreichung fehlgeschlagen.'))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={e => e.target === e.currentTarget && onClose(false)}>
      <div className="bg-portal-bg2 rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[80vh] border border-portal-border">
        <div className="flex items-center justify-between px-6 py-4 border-b border-portal-border shrink-0">
          <h2 className="text-lg font-semibold text-portal-white">Antrag neu einreichen</h2>
          <button onClick={() => onClose(false)} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {approval.decided_reason && (
            <div className="bg-portal-danger/10 rounded-lg border border-portal-danger/30 p-3">
              <p className="text-xs font-medium text-portal-danger mb-1">Ablehnungsgrund</p>
              <p className="text-sm text-portal-danger opacity-90">{approval.decided_reason}</p>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-portal-text mb-2">Bisherige Parameter</p>
            <div className="bg-portal-bg3/40 rounded-lg p-3 border border-portal-border">
              <ApprovalPayloadView payload={approval.payload} />
            </div>
          </div>

          <p className="text-sm text-portal-text2">
            Beim Neu-Einreichen wird ein neuer Antrag mit denselben Parametern erstellt. Der bisherige Antrag bleibt im Audit-Trail erhalten.
          </p>

          {error && <p className="text-sm text-portal-danger">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-portal-border shrink-0 flex justify-between">
          <button onClick={() => onClose(false)} className="btn-secondary">
            Abbrechen
          </button>
          <button
            onClick={handleResubmit}
            disabled={resubmit.isPending}
            className="btn-primary"
          >
            {resubmit.isPending ? 'Wird eingereicht …' : 'Neu einreichen'}
          </button>
        </div>
      </div>
    </div>
  )
}
