// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { getLicenseStatus } from '../../api/license'
import { listScheduledJobs } from '../../api/scheduledJobs'

function PlusGate() {
  return (
    <div className="py-10 flex flex-col items-center gap-3 text-center">
      <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center">
        <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-zinc-200">P3 Plus erforderlich</p>
      <p className="text-xs text-gray-500 dark:text-zinc-400 max-w-xs">
        Scheduled Jobs sind eine exklusive Plus-Funktion.
      </p>
    </div>
  )
}

const TYPE_BADGE = {
  playbook:     { label: 'Playbook',    cls: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' },
  ssh:          { label: 'SSH',         cls: 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300' },
  power_action: { label: 'Power',       cls: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300' },
}

function fmtDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function isJobForNode(job, nodeName) {
  if (!nodeName) return false
  const cfg = job.config ?? {}
  if (job.job_type === 'power_action') return cfg.node === nodeName
  if (job.job_type === 'playbook') {
    const params = cfg.params ?? cfg
    return params.proxmox_node === nodeName
  }
  return false
}

export default function ComputeScheduledJobsTab({ nodeName, active }) {
  const [isPlus, setIsPlus]   = useState(null)
  const [jobs, setJobs]       = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    if (!active || !nodeName) return
    if (loadedFor.current === nodeName) return
    loadedFor.current = nodeName
    setLoading(true)
    setError(null)

    getLicenseStatus()
      .then(async (lic) => {
        const plus = lic?.valid === true
        setIsPlus(plus)
        if (!plus) { setLoading(false); return }

        const allJobs = await listScheduledJobs()
        setJobs(allJobs.filter(j => isJobForNode(j, nodeName)))
        setLoading(false)
      })
      .catch(() => {
        setError('Scheduled Jobs konnten nicht geladen werden.')
        setLoading(false)
      })
  }, [active, nodeName])

  useEffect(() => {
    loadedFor.current = null
    setJobs([])
    setError(null)
    setIsPlus(null)
  }, [nodeName])

  if (loading || isPlus === null) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (!isPlus) return <PlusGate />

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">
        Keine Scheduled Jobs für diese Node konfiguriert
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Typ</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Zeitplan</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Letzter Lauf</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Nächster Lauf</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900">
          {jobs.map(j => {
            const badge = TYPE_BADGE[j.job_type] ?? { label: j.job_type, cls: 'border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-400' }
            return (
              <tr key={j.id} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
                <td className="px-4 py-2.5 text-xs text-gray-900 dark:text-zinc-100 max-w-[150px] truncate">{j.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-gray-500 dark:text-zinc-400">{j.cron_expression}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">{fmtDate(j.last_run_at)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">{fmtDate(j.next_run_at)}</td>
                <td className="px-4 py-2.5 text-xs">
                  {j.is_active
                    ? <span className="flex items-center gap-1.5 text-green-700 dark:text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />Aktiv</span>
                    : <span className="flex items-center gap-1.5 text-gray-500 dark:text-zinc-400"><span className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />Inaktiv</span>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
