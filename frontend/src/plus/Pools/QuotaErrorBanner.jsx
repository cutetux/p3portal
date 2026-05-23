// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-62: Strukturierte Darstellung einer 412-Pool-Quota-Verletzung.
// Wird in PlaybookForm eingeblendet wenn der Backend-Job-Submit mit 412
// und error="pool_quota_exceeded" antwortet.
import { useTranslation } from 'react-i18next'

// Formatiert einen einzelnen Quota-Wert (0 = unbegrenzt)
function QuotaValue({ value, unit = '' }) {
  if (value === 0 || value === null || value === undefined) {
    return <span>∞</span>
  }
  return <span>{value}{unit ? ` ${unit}` : ''}</span>
}

// Eine Zeile pro überschrittener Dimension
function ExceededRow({ dim, current, requested, limit }) {
  const labels = {
    cpu: { label: 'CPU-Kerne', unit: '' },
    ram_mb: { label: 'RAM', unit: 'MB' },
    disk_gb: { label: 'Disk', unit: 'GB' },
    vm_count: { label: 'VM/LXC-Anzahl', unit: '' },
  }
  const meta = labels[dim] ?? { label: dim, unit: '' }
  const { unit } = meta

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-xs">
      <span className="font-medium text-red-700 dark:text-red-300 w-24 shrink-0">{meta.label}</span>
      <span className="text-gray-600 dark:text-zinc-400">
        angefordert <strong><QuotaValue value={requested[dim]} unit={unit} /></strong>
        {' '}· verfügbar{' '}
        <strong>
          <QuotaValue value={limit[dim] === 0 ? 0 : Math.max(0, (limit[dim] ?? 0) - (current[dim] ?? 0))} unit={unit} />
        </strong>
        {' '}(Limit <QuotaValue value={limit[dim]} unit={unit} />, belegt <QuotaValue value={current[dim]} unit={unit} />)
      </span>
    </li>
  )
}

/**
 * Zeigt ein strukturiertes Fehler-Banner für HTTP-412-Pool-Quota-Verletzungen.
 *
 * @param {object} detail  – Axios-Fehler-Antwort: detail aus response.data.detail
 *                           Erwartete Felder: error, pool_id, exceeded[], current{}, requested{}, limit{}
 * @param {string} poolName – Optionaler Pool-Anzeigename (wird aus pools-Kontext übergeben)
 */
export default function QuotaErrorBanner({ detail, poolName }) {
  const { t } = useTranslation()

  if (!detail || detail.error !== 'pool_quota_exceeded') return null

  const { exceeded = [], current = {}, requested = {}, limit = {} } = detail
  const name = poolName ?? `Pool #${detail.pool_id}`

  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 space-y-2"
    >
      {/* Header */}
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className="w-4 h-4 text-red-500 shrink-0 mt-px">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          {t('pools.quota_exceeded_title', { name })}
        </p>
      </div>

      {/* Einzelne Dimensionen */}
      {exceeded.length > 0 && (
        <ul className="pl-6 space-y-1">
          {exceeded.map(dim => (
            <ExceededRow
              key={dim}
              dim={dim}
              current={current}
              requested={requested}
              limit={limit}
            />
          ))}
        </ul>
      )}

      <p className="pl-6 text-xs text-gray-500 dark:text-zinc-500">
        {t('pools.quota_exceeded_hint')}
      </p>
    </div>
  )
}
// p3portal.org
