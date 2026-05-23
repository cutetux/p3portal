// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Zeigt Payload-Parameter eines Approval-Antrags an (Secrets maskiert).

const SECRET_MARKER = '__secret__'

/** @param {{ payload: Record<string,any> }} */
export default function ApprovalPayloadView({ payload }) {
  if (!payload || Object.keys(payload).length === 0) {
    return <p className="text-sm text-portal-text2 italic">Keine Parameter</p>
  }

  return (
    <div className="space-y-1.5">
      {Object.entries(payload).map(([key, value]) => {
        const isSecret = value === SECRET_MARKER
        return (
          <div key={key} className="flex gap-2 text-sm">
            <span className="font-medium text-portal-text min-w-[10rem] shrink-0">{key}</span>
            {isSecret ? (
              <span className="text-portal-text3 font-mono tracking-widest">••••••</span>
            ) : (
              <span className="text-portal-white font-mono break-all">
                {typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? '')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
