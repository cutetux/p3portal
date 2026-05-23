// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * VmAlertPresetSection – Plus-only Preset-Zuweisungs-Block in der
 * VmAlertsTab (Admin-Bereich der VM/LXC-Detailseite).
 *
 * Wird über die Plus-Registry (frontend/src/plus/index.js) lazy geladen
 * und nur gerendert, wenn der Konsument (VmAlertsTab) den Plus-Status
 * bestätigt. Core-Nutzer ziehen diesen Lazy-Chunk nie nach – sie sehen
 * stattdessen ausschließlich Effektive Regeln + VM-spezifische Regeln.
 *
 * Pattern analog zu plus/Themes/ThemesAdminActions (S11) und
 * plus/Languages/LanguagesAdminActions (S14): reiner UI-Block ohne
 * eigenes Daten-Loading – Daten + Handler werden vom Konsumenten als
 * Props durchgereicht, damit der gemeinsame load()-Cycle in der Core-
 * Komponente erhalten bleibt.
 */
import PlusBadge from '../../components/common/PlusBadge'

export default function VmAlertPresetSection({ summary, presets, onAssign, onRemove }) {
  const assigned = summary?.preset

  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-widest mb-3 flex items-center">
        Preset-Zuweisung <PlusBadge />
      </h3>
      {assigned ? (
        <div className="flex items-center justify-between border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{assigned.name}</p>
            {assigned.description && (
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{assigned.description}</p>
            )}
          </div>
          <button onClick={onRemove}
            className="text-xs text-red-500 dark:text-red-400 hover:underline">
            Entfernen
          </button>
        </div>
      ) : (
        <div>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mb-2">Kein Preset zugewiesen.</p>
          {presets?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button key={p.id} onClick={() => onAssign(p.id)}
                  className="text-xs border border-gray-200 dark:border-zinc-700 px-3 py-1.5 rounded-lg text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                  {p.name} ({p.rule_count} Regeln)
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </section>
  )
}
