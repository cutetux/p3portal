// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Status-Badge für Approval-Anträge.

const STATUS_CONFIG = {
  pending:  { label: 'Ausstehend',   cls: 'bg-portal-warn/15 text-portal-warn' },
  approved: { label: 'Genehmigt',    cls: 'bg-portal-success/15 text-portal-success' },
  rejected: { label: 'Abgelehnt',    cls: 'bg-portal-danger/15 text-portal-danger' },
  cancelled:{ label: 'Storniert',    cls: 'bg-portal-bg3 text-portal-text2' },
  expired:  { label: 'Abgelaufen',   cls: 'bg-portal-bg3 text-portal-text2' },
  suspended:{ label: 'Suspendiert',  cls: 'bg-portal-accent/15 text-portal-accent' },
  executed: { label: 'Ausgeführt',   cls: 'bg-portal-info/15 text-portal-info' },
}

export default function ApprovalStatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-portal-bg3 text-portal-text2' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
