// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { toggleScheduledJob, deleteScheduledJob, runScheduledJobNow } from '../../api/scheduledJobs'

const TYPE_BADGE = {
  playbook:     { label: 'Playbook', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  ssh:          { label: 'SSH', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  power_action: { label: 'Power', cls: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
}

const STATUS_INFO = {
  success: { icon: '✅', cls: 'text-green-600 dark:text-green-400' },
  failed:  { icon: '❌', cls: 'text-red-600 dark:text-red-400' },
  running: { icon: '⏳', cls: 'text-orange-600 dark:text-orange-400 animate-pulse' },
}

function fmtDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function ActionBtn({ onClick, disabled, title, children, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
        danger
          ? 'text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30'
          : ' btn-ghost hover:bg-gray-100 dark:hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  )
}

export default function ScheduledJobsTable({ jobs, onEdit, onDetail, onReload }) {
  const [busyId, setBusyId] = useState(null)

  const withBusy = async (id, fn) => {
    setBusyId(id)
    try { await fn() } catch { /* ignore */ } finally { setBusyId(null); onReload() }
  }

  if (jobs.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-zinc-500">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mx-auto mb-3 opacity-40">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <p className="text-sm">Noch keine Scheduled Jobs vorhanden.</p>
        <p className="text-xs mt-1">Erstelle deinen ersten Job mit &quot;Neuer Job&quot;.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-zinc-800">
            {['Name', 'Typ', 'Zeitplan', 'Letzter Run', 'Status', ''].map(h => (
              <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map(job => {
            const badge  = TYPE_BADGE[job.job_type] ?? { label: job.job_type, cls: 'bg-gray-100 text-gray-700' }
            const status = STATUS_INFO[job.last_run_status]
            const busy   = busyId === job.id
            const isRunning = job.last_run_status === 'running'

            return (
              <tr
                key={job.id}
                className={`border-b border-gray-50 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors ${!job.active ? 'opacity-60' : ''}`}
              >
                {/* Name */}
                <td className="px-4 py-3 max-w-[200px]">
                  <button
                    onClick={() => onDetail(job)}
                    className="text-left hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                  >
                    <p className="font-medium text-gray-900 dark:text-zinc-100 truncate">{job.name}</p>
                    {job.description && (
                      <p className="text-xs text-gray-400 dark:text-zinc-500 truncate">{job.description}</p>
                    )}
                  </button>
                </td>

                {/* Typ */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  {job.child_job && (
                    <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                      Fenster
                    </span>
                  )}
                </td>

                {/* Zeitplan */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <code className="text-xs font-mono text-gray-600 dark:text-zinc-300">{job.cron_expression}</code>
                  {job.next_run_at && (
                    <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                      Nächster: {fmtDate(job.next_run_at)}
                    </p>
                  )}
                </td>

                {/* Letzter Run */}
                <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-zinc-400">
                  {fmtDate(job.last_run_at)}
                </td>

                {/* Status */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {status ? (
                    <span className={`text-sm ${status.cls}`}>{status.icon}</span>
                  ) : job.last_run_status ? (
                    <span className="text-xs text-gray-400 dark:text-zinc-500">{job.last_run_status}</span>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-zinc-600">–</span>
                  )}
                </td>

                {/* Aktionen */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-0.5 justify-end">
                    {/* Jetzt ausführen */}
                    <ActionBtn
                      onClick={() => withBusy(job.id, () => runScheduledJobNow(job.id))}
                      disabled={busy || isRunning}
                      title={isRunning ? 'Job läuft bereits' : 'Jetzt ausführen'}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    </ActionBtn>

                    {/* Bearbeiten */}
                    <ActionBtn onClick={() => onEdit(job)} disabled={busy} title="Bearbeiten">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </ActionBtn>

                    {/* Aktiv/Inaktiv Toggle */}
                    <ActionBtn
                      onClick={() => withBusy(job.id, () => toggleScheduledJob(job.id))}
                      disabled={busy}
                      title={job.active ? 'Pausieren' : 'Aktivieren'}
                    >
                      {job.active ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                          <polyline points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                    </ActionBtn>

                    {/* Löschen */}
                    <ActionBtn
                      onClick={() => {
                        if (!confirm(`Job "${job.name}" wirklich löschen?`)) return
                        withBusy(job.id, () => deleteScheduledJob(job.id))
                      }}
                      disabled={busy}
                      title="Löschen"
                      danger
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </ActionBtn>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
