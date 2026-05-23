// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Requester-Sicht – Meine Anträge (Tab in MyAccountPage).
import { useState } from 'react'
import { useMyApprovalsList, useCancelApproval } from '../hooks'
import ApprovalStatusBadge from './ApprovalStatusBadge'
import ApprovalDetailModal from './ApprovalDetailModal'
import MyApprovalsResubmitModal from './MyApprovalsResubmitModal'
import ExpiresAtDisplay from './ExpiresAtDisplay'
import { formatApiError } from '../../../api/errors'

const STATUSES = ['', 'pending', 'suspended', 'approved', 'rejected', 'cancelled', 'expired', 'executed']

export default function MyApprovalsTab() {
  const [filterStatus, setFilterStatus] = useState('')
  const [detailItem, setDetailItem] = useState(null)
  const [resubmitItem, setResubmitItem] = useState(null)
  const [cancelError, setCancelError] = useState(null)

  const { data, isLoading } = useMyApprovalsList(filterStatus ? { status: filterStatus } : {})
  const cancelMut = useCancelApproval()

  const items = data?.items ?? []

  async function handleCancel(id, e) {
    e.stopPropagation()
    setCancelError(null)
    try {
      await cancelMut.mutateAsync({ id })
    } catch (err) {
      setCancelError(formatApiError(err, 'Stornierung fehlgeschlagen.'))
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-portal-border rounded-lg px-3 py-1.5 bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent"
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s === '' ? 'Alle Status' : s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
        <span className="text-sm text-portal-text2">{items.length} Einträge</span>
      </div>

      {cancelError && (
        <p className="text-sm text-portal-danger">{cancelError}</p>
      )}

      {isLoading && <p className="text-sm text-portal-text3 py-4 text-center">Lade …</p>}

      {!isLoading && items.length === 0 && (
        <p className="text-sm text-portal-text3 py-4 text-center italic">Keine Anträge vorhanden</p>
      )}

      <div className="divide-y divide-portal-border/50">
        {items.map(item => (
          <div
            key={item.id}
            onClick={() => setDetailItem(item)}
            className="py-3 flex items-start justify-between gap-3 cursor-pointer hover:bg-portal-bg3/40 rounded-lg px-2 -mx-2 transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-portal-white">{item.action_target}</span>
                <ApprovalStatusBadge status={item.status} />
                {item.self_approval && (
                  <span className="text-xs text-portal-warn">(Self-Approval)</span>
                )}
              </div>
              <p className="text-xs text-portal-text2 mt-0.5">
                {item.action_type} · {new Date(item.requested_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
              {item.status === 'pending' && (
                <p className="text-xs mt-0.5">
                  Läuft ab: <ExpiresAtDisplay expiresAt={item.expires_at} />
                </p>
              )}
              {item.decided_reason && (
                <p className="text-xs text-portal-text2 mt-0.5 truncate max-w-xs">
                  Begründung: {item.decided_reason}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {(item.status === 'rejected' || item.status === 'suspended') && (
                <button
                  onClick={e => { e.stopPropagation(); setResubmitItem(item) }}
                  className="px-2.5 py-1 text-xs font-medium rounded border border-portal-accent text-portal-accent hover:bg-portal-accent hover:text-white transition-colors"
                >
                  Neu einreichen
                </button>
              )}
              {item.status === 'pending' && (
                <button
                  onClick={e => handleCancel(item.id, e)}
                  disabled={cancelMut.isPending}
                  className="px-2.5 py-1 text-xs font-medium rounded border border-portal-danger/30 text-portal-danger hover:bg-portal-danger/10 transition-colors disabled:opacity-50"
                >
                  Zurückziehen
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {detailItem && (
        <ApprovalDetailModal approval={detailItem} onClose={() => setDetailItem(null)} />
      )}
      {resubmitItem && (
        <MyApprovalsResubmitModal approval={resubmitItem} onClose={() => setResubmitItem(null)} />
      )}
    </div>
  )
}
