// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Warn-Banner für Self-Approval (Plus-only) – PROJ-58 portal-warn statt yellow.

/** @param {{ enabled: boolean, reason: string, onReasonChange: Function }} */
export default function SelfApprovalWarningBanner({ enabled, reason, onReasonChange }) {
  if (!enabled) {
    return (
      <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 p-4">
        <p className="text-sm text-portal-warn font-medium">
          Self-Approval ist deaktiviert
        </p>
        <p className="text-sm text-portal-warn mt-1 opacity-90">
          Du kannst keinen eigenen Antrag genehmigen. Bitte wende dich an einen anderen Approver.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-portal-warn shrink-0 mt-0.5">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <p className="text-sm font-medium text-portal-warn">
            Selbst-Freigabe — Begründung erforderlich
          </p>
          <p className="text-sm text-portal-warn opacity-90 mt-0.5">
            Du genehmigst deinen eigenen Antrag. Diese Aktion wird im Audit-Log als Self-Approval markiert.
          </p>
        </div>
      </div>
      <textarea
        value={reason}
        onChange={e => onReasonChange(e.target.value)}
        rows={3}
        className="w-full border border-portal-warn/30 rounded-lg px-3 py-2 text-sm bg-portal-bg2 text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-warn/60"
        placeholder="Begründung für Self-Approval (mind. 10 Zeichen) …"
        autoFocus
      />
      {reason.trim().length > 0 && reason.trim().length < 10 && (
        <p className="text-xs text-portal-warn opacity-90">
          Noch {10 - reason.trim().length} Zeichen erforderlich
        </p>
      )}
    </div>
  )
}
