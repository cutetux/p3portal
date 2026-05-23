// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Detail-Modal für einen Approval-Antrag (PROJ-58 portal-* Tokens).
import { useState } from 'react'
import { formatApiError } from '../../../api/errors'
import { useApproveApproval, useRejectApproval } from '../hooks'
import ModalHelpButton from '../../../features/help/components/ModalHelpButton'
import ApprovalStatusBadge from './ApprovalStatusBadge'
import ApprovalPayloadView from './ApprovalPayloadView'
import ExpiresAtDisplay from './ExpiresAtDisplay'
import SelfApprovalWarningBanner from './SelfApprovalWarningBanner'

const ACTION_TYPE_LABELS = {
  playbook_run:         'Playbook-Ausführung',
  packer_build:         'Packer-Build',
  vm_delete:            'VM löschen',
  lxc_delete:           'LXC löschen',
  template_delete:      'Template löschen',
  owner_delete_request: 'Eigentümer-Löschantrag',
  owner_adopt_request:  'VM adoptieren',
}

/** @param {{ approval: object, onClose: Function }} */
export default function ApprovalDetailModal({ approval, onClose }) {
  const [reason, setReason] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [view, setView] = useState('detail') // 'detail' | 'approve' | 'reject'
  const [error, setError] = useState(null)

  const approveMut = useApproveApproval()
  const rejectMut  = useRejectApproval()

  const isSelfApproval = approval.is_own_request && approval.can_approve
  const allowSelfApproval = approval.rule_snapshot?.allow_self_approval === true

  async function handleApprove() {
    if (isSelfApproval && !allowSelfApproval) return
    if (isSelfApproval && allowSelfApproval && reason.trim().length < 10) {
      setError('Begründung für Self-Approval muss mindestens 10 Zeichen enthalten.')
      return
    }
    setError(null)
    try {
      await approveMut.mutateAsync({ id: approval.id, reason: reason || undefined })
      onClose(true)
    } catch (err) {
      setError(formatApiError(err, 'Genehmigung fehlgeschlagen.'))
    }
  }

  async function handleReject() {
    if (rejectReason.trim().length < 10) {
      setError('Begründung muss mindestens 10 Zeichen enthalten.')
      return
    }
    setError(null)
    try {
      await rejectMut.mutateAsync({ id: approval.id, reason: rejectReason })
      onClose(true)
    } catch (err) {
      setError(formatApiError(err, 'Ablehnung fehlgeschlagen.'))
    }
  }

  const isPending = approval.status === 'pending'
  const busy = approveMut.isPending || rejectMut.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={e => e.target === e.currentTarget && onClose(false)}>
      <div className="bg-portal-bg2 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] border border-portal-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-portal-border shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-portal-white">
              {ACTION_TYPE_LABELS[approval.action_type] ?? approval.action_type}
            </h2>
            <ApprovalStatusBadge status={approval.status} />
          </div>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.approval_detail" />
            <button onClick={() => onClose(false)} className="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-portal-text2">Antragsteller</span>
              <p className="font-medium text-portal-white mt-0.5">{approval.requester_username ?? '—'}</p>
            </div>
            <div>
              <span className="text-portal-text2">Ziel</span>
              <p className="font-medium text-portal-white mt-0.5">{approval.action_target}</p>
            </div>
            <div>
              <span className="text-portal-text2">Beantragt</span>
              <p className="font-medium text-portal-white mt-0.5">
                {new Date(approval.requested_at).toLocaleString('de-DE')}
              </p>
            </div>
            {approval.status === 'pending' && (
              <div>
                <span className="text-portal-text2">Läuft ab in</span>
                <p className="mt-0.5">
                  <ExpiresAtDisplay expiresAt={approval.expires_at} />
                </p>
              </div>
            )}
            {approval.decided_at && (
              <div>
                <span className="text-portal-text2">Entschieden</span>
                <p className="font-medium text-portal-white mt-0.5">
                  {new Date(approval.decided_at).toLocaleString('de-DE')} von {approval.decided_by_username ?? '—'}
                </p>
              </div>
            )}
          </div>

          {/* Rejection reason display */}
          {approval.decided_reason && (
            <div className="bg-portal-bg3/40 rounded-lg p-3 border border-portal-border">
              <p className="text-xs font-medium text-portal-text2 mb-1">Begründung</p>
              <p className="text-sm text-portal-text">{approval.decided_reason}</p>
            </div>
          )}

          {/* Parameters */}
          <div>
            <h3 className="text-sm font-medium text-portal-text mb-2">Parameter</h3>
            <div className="bg-portal-bg3/40 rounded-lg p-3 border border-portal-border">
              <ApprovalPayloadView payload={approval.payload} />
            </div>
          </div>

          {/* Self-approval warning */}
          {view === 'approve' && isSelfApproval && (
            <SelfApprovalWarningBanner
              enabled={allowSelfApproval}
              reason={reason}
              onReasonChange={setReason}
            />
          )}

          {/* Approve reason */}
          {view === 'approve' && !isSelfApproval && (
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Begründung <span className="text-portal-text3 font-normal">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                className="w-full border border-portal-border rounded-lg px-3 py-2 text-sm bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent"
                placeholder="Optionale Begründung für die Genehmigung …"
              />
            </div>
          )}

          {/* Reject reason */}
          {view === 'reject' && (
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Ablehnungsgrund <span className="text-portal-danger">*</span>
                <span className="text-portal-text3 font-normal ml-1">(mind. 10 Zeichen)</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                className="w-full border border-portal-border rounded-lg px-3 py-2 text-sm bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent"
                placeholder="Warum wird dieser Antrag abgelehnt? …"
                autoFocus
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-portal-danger">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-portal-border shrink-0 flex items-center justify-between gap-3">
          <button
            onClick={() => onClose(false)}
            className="btn-secondary transition-colors"
          >
            Schließen
          </button>

          {isPending && approval.can_approve && (
            <div className="flex gap-2">
              {view === 'detail' && (
                <>
                  <button
                    onClick={() => { setView('reject'); setError(null) }}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-portal-danger/30 text-portal-danger hover:bg-portal-danger/10 transition-colors"
                  >
                    Ablehnen
                  </button>
                  <button
                    onClick={() => { setView('approve'); setError(null) }}
                    disabled={isSelfApproval && !allowSelfApproval}
                    className="btn-primary"
                    title={isSelfApproval && !allowSelfApproval ? 'Self-Approval ist deaktiviert' : undefined}
                  >
                    Genehmigen
                  </button>
                </>
              )}
              {view === 'approve' && (
                <>
                  <button onClick={() => { setView('detail'); setError(null) }} className="btn-secondary">
                    Zurück
                  </button>
                  <button
                    onClick={handleApprove}
                    disabled={busy || (isSelfApproval && allowSelfApproval && reason.trim().length < 10)}
                    className="btn-primary"
                  >
                    {busy ? 'Bitte warten …' : 'Jetzt genehmigen'}
                  </button>
                </>
              )}
              {view === 'reject' && (
                <>
                  <button onClick={() => { setView('detail'); setError(null) }} className="btn-secondary">
                    Zurück
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={busy || rejectReason.trim().length < 10}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-portal-danger hover:bg-portal-danger/90 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                  >
                    {busy ? 'Bitte warten …' : 'Ablehnen bestätigen'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
