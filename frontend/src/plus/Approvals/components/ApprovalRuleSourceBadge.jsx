// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Status-Pill für die Quelle einer Approval-Regel.

/** @param {{ source: string, hasConflict?: boolean }} props */
export default function ApprovalRuleSourceBadge({ source, hasConflict = false }) {
  if (hasConflict) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-portal-accent/15 text-portal-accent">
        Konflikt
      </span>
    )
  }
  if (source === 'meta_yaml') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-portal-success/15 text-portal-success">
        meta.yaml
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-portal-info/15 text-portal-info">
      UI-Override
    </span>
  )
}
