// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * AddNodeCard – Plus-only Karte zum Hinzufügen einer weiteren Proxmox-Node.
 * Erscheint im Compute-Nodes-Grid neben den existierenden NodeCards. Klick
 * springt in die Node-Verwaltungsoberfläche.
 *
 * Wird über die Plus-Registry (frontend/src/plus/index.js) lazy geladen
 * und nur gerendert, wenn der Nutzer Plus-Lizenz und manage_nodes-Rechte
 * besitzt – die Render-Bedingung lebt im Konsumenten.
 */
export default function AddNodeCard({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[140px] w-full flex flex-col items-center justify-center gap-2.5 border-2 border-dashed border-gray-300 dark:border-zinc-700 rounded-lg text-gray-400 dark:text-zinc-500 hover:border-orange-400 dark:hover:border-orange-600 hover:text-orange-500 dark:hover:text-orange-400 transition-all group"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-7 h-7 group-hover:scale-110 transition-transform">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      <span className="text-sm font-medium">Node hinzufügen</span>
      <span className="rq hidden" aria-hidden="true" />
    </button>
  )
}
