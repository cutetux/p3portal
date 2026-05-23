// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { useScheduledJobRuns } from '../../hooks/useScheduledJobs'

const STATUS_COLOR = {
  running: 'text-orange-600 dark:text-orange-400',
  success: 'text-green-600 dark:text-green-400',
  failed:  'text-red-600 dark:text-red-400',
}

const STATUS_DOT = {
  running: 'bg-orange-500 animate-pulse',
  success: 'bg-green-500',
  failed:  'bg-red-500',
}

function fmtDate(iso) {
  if (!iso) return '–'
  const d = new Date(iso)
  return d.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDuration(started, finished) {
  if (!started || !finished) return null
  const ms = new Date(finished) - new Date(started)
  if (ms < 0) return null
  if (ms < 60000) return `${Math.round(ms / 1000)} s`
  return `${Math.round(ms / 60000)} min`
}

function RunEntry({ run }) {
  const [open, setOpen] = useState(false)
  const duration = fmtDuration(run.started_at, run.finished_at)
  const actionLabel = run.action ? ` (${run.action})` : ''

  return (
    <div className="border border-gray-100 dark:border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition-colors"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[run.status] ?? 'bg-gray-400'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium ${STATUS_COLOR[run.status] ?? 'text-gray-500'}`}>
              {run.status}{actionLabel}
            </span>
            {run.exit_code != null && (
              <span className="text-xs text-gray-400 dark:text-zinc-500">Exit {run.exit_code}</span>
            )}
            <span className="text-xs text-gray-400 dark:text-zinc-500">·</span>
            <span className="text-xs text-gray-500 dark:text-zinc-400 font-mono">
              {run.triggered_by === 'manual' ? 'manuell' : 'Zeitplan'}
            </span>
          </div>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
            {fmtDate(run.started_at)}
            {duration && <span className="ml-2">({duration})</span>}
          </p>
        </div>
        <svg
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className={`w-3.5 h-3.5 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 px-4 py-3">
          {run.output ? (
            <pre className="text-xs font-mono text-gray-700 dark:text-zinc-300 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
              {run.output}
            </pre>
          ) : (
            <p className="text-xs text-gray-400 dark:text-zinc-500 italic">Kein Output vorhanden.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function RunHistoryList({ jobId }) {
  const { runs, loading, error, reload } = useScheduledJobRuns(jobId)

  if (loading) {
    return <p className="text-sm text-gray-400 dark:text-zinc-500 py-4 text-center">Lädt Run-History…</p>
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-red-500">Fehler beim Laden der Run-History.</p>
        <button onClick={reload} className="mt-2 text-xs text-orange-600 dark:text-orange-400 hover:underline">Erneut versuchen</button>
      </div>
    )
  }

  if (runs.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-zinc-500 py-4 text-center italic">Noch keine Runs vorhanden.</p>
  }

  return (
    <div className="space-y-2">
      {runs.map(run => <RunEntry key={run.id} run={run} />)}
    </div>
  )
}
