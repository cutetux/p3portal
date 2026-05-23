// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import RunHistoryList from './RunHistoryList'

const TYPE_BADGE = {
  playbook:     { label: 'Ansible Playbook', cls: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  ssh:          { label: 'SSH-Befehl', cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  power_action: { label: 'Power-Aktion', cls: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
}

function fmtDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function Row({ label, value }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-gray-50 dark:border-zinc-800 last:border-0">
      <dt className="w-40 shrink-0 text-xs text-gray-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-xs text-gray-900 dark:text-zinc-100 font-mono break-all">{value}</dd>
    </div>
  )
}

function JobConfig({ job }) {
  const cfg = job.config ?? {}
  if (job.job_type === 'ssh') return (
    <dl>
      <Row label="Ziel" value={cfg.user_host ?? '–'} />
      <Row label="Befehl" value={cfg.command ?? '–'} />
      <Row label="SSH-Key" value={cfg.ssh_key_source ?? '–'} />
      <Row label="Timeout" value={`${cfg.timeout ?? 30} s`} />
    </dl>
  )
  if (job.job_type === 'power_action') return (
    <dl>
      <Row label="Node" value={cfg.node ?? '–'} />
      <Row label="VMID" value={String(cfg.vmid ?? '–')} />
      <Row label="Typ" value={cfg.vmtype ?? 'qemu'} />
      <Row label="Aktion" value={cfg.action ?? '–'} />
      {job.child_job && (
        <Row label="Stop-Zeitplan" value={job.child_job.cron_expression ?? '–'} />
      )}
    </dl>
  )
  if (job.job_type === 'playbook') return (
    <dl>
      <Row label="Playbook" value={cfg.playbook ?? '–'} />
      {cfg.params && Object.entries(cfg.params).map(([k, v]) => (
        <Row key={k} label={k} value={String(v)} />
      ))}
    </dl>
  )
  return null
}

export default function ScheduledJobDetailModal({ job, onClose }) {
  const badge = TYPE_BADGE[job.job_type] ?? { label: job.job_type, cls: 'bg-gray-100 text-gray-700' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl w-full max-w-2xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{job.name}</h2>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
              {!job.active && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
                  pausiert
                </span>
              )}
            </div>
            {job.description && (
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">{job.description}</p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost transition-colors ml-4 shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Job-Metadaten */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Konfiguration
            </h3>
            <dl className="bg-gray-50 dark:bg-zinc-800/50 rounded-lg px-4 py-1">
              <Row label="Zeitplan" value={job.cron_expression} />
              <Row label="Erstellt von" value={job.created_by} />
              <Row label="Erstellt am" value={fmtDate(job.created_at)} />
              <Row label="Letzter Run" value={fmtDate(job.last_run_at)} />
              <Row label="Nächster Run" value={fmtDate(job.next_run_at)} />
            </dl>
          </section>

          {/* Typ-Konfiguration */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Job-Details
            </h3>
            <div className="bg-gray-50 dark:bg-zinc-800/50 rounded-lg px-4 py-1">
              <JobConfig job={job} />
            </div>
          </section>

          {/* Run-History */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              Run-History
            </h3>
            <RunHistoryList jobId={job.id} />
          </section>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100 dark:border-zinc-800 shrink-0">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 px-4 py-2 transition-colors"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
