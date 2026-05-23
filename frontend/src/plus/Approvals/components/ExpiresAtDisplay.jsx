// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Zeigt verbleibende Zeit bis zum Ablauf eines Antrags.
import { useEffect, useState } from 'react'

function formatRemaining(expiresAt) {
  const diff = new Date(expiresAt) - Date.now()
  if (diff <= 0) return 'Abgelaufen'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  return `${h}h ${m}m`
}

/** @param {{ expiresAt: string }} */
export default function ExpiresAtDisplay({ expiresAt }) {
  const [label, setLabel] = useState(() => formatRemaining(expiresAt))

  useEffect(() => {
    setLabel(formatRemaining(expiresAt))
    const id = setInterval(() => setLabel(formatRemaining(expiresAt)), 60_000)
    return () => clearInterval(id)
  }, [expiresAt])

  const diff = new Date(expiresAt) - Date.now()
  const isCritical = diff > 0 && diff < 2 * 3_600_000

  return (
    <span
      className={`text-sm ${
        diff <= 0
          ? 'text-portal-danger'
          : isCritical
          ? 'text-portal-warn font-medium'
          : 'text-portal-text2'
      }`}
    >
      {label}
    </span>
  )
}
