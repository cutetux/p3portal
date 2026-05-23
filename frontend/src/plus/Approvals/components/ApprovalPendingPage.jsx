// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Landing-Page nach Antrag-Submit (PROJ-58 portal-* Tokens).
import { useNavigate, useParams } from 'react-router-dom'
import { formatApiError } from '../../../api/errors'
import { useApproval, useCancelApproval } from '../hooks'
import ApprovalStatusBadge from './ApprovalStatusBadge'
import ApprovalPayloadView from './ApprovalPayloadView'
import ExpiresAtDisplay from './ExpiresAtDisplay'
import { useState } from 'react'

const ACTION_TYPE_LABELS = {
  playbook_run:         'Playbook-Ausführung',
  packer_build:         'Packer-Build',
  vm_delete:            'VM löschen',
  lxc_delete:           'LXC löschen',
  template_delete:      'Template löschen',
  owner_delete_request: 'Owner-Löschantrag',
  owner_adopt_request:  'VM adoptieren',
}

export default function ApprovalPendingPage() {
  const { approvalId } = useParams()
  const navigate = useNavigate()
  const [cancelError, setCancelError] = useState(null)

  const { data: approval, isLoading, error } = useApproval(approvalId)
  const cancelMut = useCancelApproval()

  async function handleCancel() {
    setCancelError(null)
    try {
      await cancelMut.mutateAsync({ id: approvalId })
      navigate('/provisioning')
    } catch (err) {
      setCancelError(formatApiError(err, 'Stornierung fehlgeschlagen.'))
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-portal-text3">Lade Antrag …</p>
      </div>
    )
  }

  if (error || !approval) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-portal-danger">Antrag nicht gefunden oder kein Zugriff.</p>
          <button onClick={() => navigate(-1)} className="text-sm text-portal-accent hover:underline">Zurück</button>
        </div>
      </div>
    )
  }

  // Wenn der Job ausgeführt wurde → zu den Events weiterleiten
  if (approval.status === 'executed' && approval.job_id) {
    navigate(`/events/${approval.job_id}`, { replace: true })
    return null
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-portal-white">
            Antrag ausstehend
          </h1>
          <ApprovalStatusBadge status={approval.status} />
        </div>

        {/* Status-Card */}
        <div className="bg-portal-bg2 rounded-xl border border-portal-border p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-portal-text2">Aktion</p>
              <p className="font-medium text-portal-white mt-0.5">
                {ACTION_TYPE_LABELS[approval.action_type] ?? approval.action_type}
              </p>
            </div>
            <div>
              <p className="text-portal-text2">Ziel</p>
              <p className="font-medium text-portal-white mt-0.5 font-mono">{approval.action_target}</p>
            </div>
            <div>
              <p className="text-portal-text2">Beantragt</p>
              <p className="font-medium text-portal-white mt-0.5">
                {new Date(approval.requested_at).toLocaleString('de-DE')}
              </p>
            </div>
            {approval.status === 'pending' && (
              <div>
                <p className="text-portal-text2">Läuft ab in</p>
                <p className="mt-0.5">
                  <ExpiresAtDisplay expiresAt={approval.expires_at} />
                </p>
              </div>
            )}
          </div>

          {/* Antrag-ID */}
          <p className="text-xs text-portal-text3 font-mono">ID: {approval.id}</p>
        </div>

        {/* Entscheidungs-Info */}
        {approval.status === 'approved' && !approval.job_id && (
          <div className="bg-portal-success/10 border border-portal-success/30 rounded-lg p-4">
            <p className="text-sm font-medium text-portal-success">
              Genehmigt – Job wird vorbereitet …
            </p>
          </div>
        )}

        {approval.status === 'rejected' && (
          <div className="bg-portal-danger/10 border border-portal-danger/30 rounded-lg p-4">
            <p className="text-sm font-medium text-portal-danger">Abgelehnt</p>
            {approval.decided_reason && (
              <p className="text-sm text-portal-danger opacity-90 mt-1">{approval.decided_reason}</p>
            )}
          </div>
        )}

        {approval.status === 'suspended' && (
          <div className="bg-portal-accent/10 border border-portal-accent/30 rounded-lg p-4">
            <p className="text-sm font-medium text-portal-accent">Suspendiert</p>
            <p className="text-sm text-portal-accent opacity-90 mt-1">
              Die Approval-Regel hat sich geändert. Bitte Antrag neu einreichen oder zurückziehen.
            </p>
          </div>
        )}

        {/* Parameter */}
        <div className="bg-portal-bg2 rounded-xl border border-portal-border p-5">
          <h3 className="text-sm font-semibold text-portal-text mb-3">Parameter</h3>
          <ApprovalPayloadView payload={approval.payload} />
        </div>

        {cancelError && <p className="text-sm text-portal-danger">{cancelError}</p>}

        {/* Aktionen */}
        <div className="flex gap-3">
          <button
            onClick={() => navigate(-1)}
            className="btn-secondary transition-colors"
          >
            ← Zurück
          </button>
          <button
            onClick={() => navigate('/account?tab=workflow&sub=antraege')}
            className="px-4 py-2 text-sm text-portal-accent hover:underline"
          >
            Alle meine Anträge
          </button>
          {approval.status === 'pending' && (
            <button
              onClick={handleCancel}
              disabled={cancelMut.isPending}
              className="ml-auto px-4 py-2 text-sm font-medium rounded-lg border border-portal-danger/30 text-portal-danger hover:bg-portal-danger/10 transition-colors disabled:opacity-50"
            >
              Antrag zurückziehen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
