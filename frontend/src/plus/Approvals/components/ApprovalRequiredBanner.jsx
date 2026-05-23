// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Info-Banner im Submit-Modal (PROJ-58 portal-info statt blue).

/**
 * @param {{
 *   approverInfo?: string,
 *   expirationHours?: number,
 * }} props
 */
export default function ApprovalRequiredBanner({ approverInfo, expirationHours = 48 }) {
  return (
    <div className="rounded-lg border border-portal-info/30 bg-portal-info/10 p-3.5 flex gap-2.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-portal-info shrink-0 mt-0.5">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <div>
        <p className="text-sm font-medium text-portal-info">
          Diese Aktion erfordert eine Freigabe
        </p>
        <p className="text-sm text-portal-info opacity-90 mt-0.5">
          {approverInfo
            ? `Freigabe durch: ${approverInfo}`
            : 'Dein Antrag wird nach dem Absenden zur Genehmigung weitergeleitet.'}
          {' '}Der Antrag läuft nach {expirationHours}h ab.
        </p>
      </div>
    </div>
  )
}
