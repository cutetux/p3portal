// p3portal.org
/**
 * PROJ-78: Datacenter-wide Proxmox backup job management tab.
 * Shows all scheduled backup jobs for the Proxmox installation a node belongs to.
 * Provides CRUD + run-now for users with manage_backup_jobs or admin role.
 */
import { useState, useEffect, useCallback } from 'react'
import { listBackupJobs, deleteBackupJob, updateBackupJob, runBackupNow } from '../../api/backupJobs'
import BackupJobFormModal from './BackupJobFormModal'
import ConfirmModal from '../common/ConfirmModal'

// ── Helper: human-readable schedule hint ────────────────────────────────────

function scheduleHint(schedule) {
  if (!schedule) return ''
  const s = schedule.trim()
  // Simple Proxmox calendar-event / cron display
  if (s.match(/^\d{2}:\d{2}$/)) return `täglich um ${s}`
  if (s === 'daily')             return 'täglich'
  if (s === 'weekly')            return 'wöchentlich'
  if (s === 'monthly')           return 'monatlich'
  return ''
}

// ── Helper: VM-Auswahl Kurzform ───────────────────────────────────────────────

function vmSelLabel(job) {
  if (job.vmid)                    return `VMIDs: ${job.vmid}`
  if (job.pool)                    return `Pool: ${job.pool}`
  if (job.all && job.exclude)      return `Alle außer ${job.exclude}`
  if (job.all)                     return 'Alle Gäste'
  return '–'
}

// ── Helper: Retention Kurzform ────────────────────────────────────────────────

function retentionLabel(retention) {
  if (!retention) return '–'
  const parts = []
  if (retention.keep_last    != null) parts.push(`letzten ${retention.keep_last}`)
  if (retention.keep_daily   != null) parts.push(`${retention.keep_daily}×tägl.`)
  if (retention.keep_weekly  != null) parts.push(`${retention.keep_weekly}×wöch.`)
  if (retention.keep_monthly != null) parts.push(`${retention.keep_monthly}×mon.`)
  return parts.length > 0 ? parts.join(', ') : '–'
}

// ── Helper: error message from API error ──────────────────────────────────────

function apiErrMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien für die Backup-Job-Verwaltung.'
  if (s === 503) return 'Admin-Token für diese Node nicht konfiguriert.'
  if (s === 502) return 'Proxmox nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Ausführen der Aktion.'
}

// ── Aktionen-Button-Leiste ────────────────────────────────────────────────────

function JobActions({ job, onEdit, onDelete, onRun, busy }) {
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button
        onClick={() => onEdit(job)}
        disabled={busy}
        className="btn-table"
        title="Bearbeiten"
      >
        Bearbeiten
      </button>
      <button
        onClick={() => onRun(job)}
        disabled={busy}
        className="btn-table"
        title="Jetzt sichern"
      >
        Jetzt sichern
      </button>
      <button
        onClick={() => onDelete(job)}
        disabled={busy}
        className="btn-table-danger"
        title="Löschen"
      >
        Löschen
      </button>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ComputeBackupJobsTab({ nodeName, active }) {
  const [data, setData]           = useState(null)   // { jobs, permission_denied, node_unreachable }
  const [loading, setLoading]     = useState(false)
  const [togglingId, setTogglingId] = useState(null) // job id being toggled

  // Modal states
  const [formJob, setFormJob]         = useState(undefined) // undefined = closed, null = create, obj = edit
  const [deleteJob, setDeleteJob]     = useState(null)
  const [runJob, setRunJob]           = useState(null)
  const [runResult, setRunResult]     = useState(null)  // { tasks: [...] } after run-now
  const [actionError, setActionError] = useState('')

  const load = useCallback(() => {
    if (!nodeName) return
    setLoading(true)
    listBackupJobs(nodeName)
      .then(d => setData(d))
      .catch(err => setData({ jobs: [], node_unreachable: true, detail: apiErrMsg(err) }))
      .finally(() => setLoading(false))
  }, [nodeName])

  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  // Reset on node change
  useEffect(() => {
    setData(null)
    setFormJob(undefined)
    setDeleteJob(null)
    setRunJob(null)
    setRunResult(null)
    setActionError('')
  }, [nodeName])

  // ── Aktiv-Toggle ──────────────────────────────────────────────────────────

  const handleToggleEnabled = async (job) => {
    setTogglingId(job.id)
    setActionError('')
    try {
      // Build minimal update payload mirroring the full job but flipping enabled
      const payload = {
        schedule: job.schedule,
        storage:  job.storage,
        mode:     job.mode,
        compress: job.compress || 'zstd',
        enabled:  !job.enabled,
        comment:  job.comment || '',
        mailto:   job.mailto  || '',
        all_vms:  Boolean(job.all && !job.exclude),
        vmids:    job.vmid    || '',
        pool:     job.pool    || '',
        exclude:  job.exclude || '',
        retention: job.retention ?? {},
      }
      // Handle all+exclude case
      if (job.all && job.exclude) {
        payload.all_vms = true
        payload.exclude = job.exclude
      }
      await updateBackupJob(nodeName, job.id, payload)
      // Optimistic update
      setData(prev => prev ? {
        ...prev,
        jobs: prev.jobs.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j),
      } : prev)
    } catch (err) {
      setActionError(apiErrMsg(err))
    } finally {
      setTogglingId(null)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    try {
      await deleteBackupJob(nodeName, deleteJob.id)
      load()
    } catch (err) {
      throw new Error(apiErrMsg(err))
    }
  }

  // ── Run now ───────────────────────────────────────────────────────────────

  const handleRunConfirm = async () => {
    try {
      const result = await runBackupNow(nodeName, runJob.id)
      setRunResult(result)
      // Don't close automatically – show result to user; user closes via "OK"
    } catch (err) {
      throw new Error(apiErrMsg(err))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (data?.node_unreachable) {
    return (
      <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
        Node nicht erreichbar – Backup-Jobs konnten nicht geladen werden.
        {data.detail && (
          <span className="block mt-1 text-xs text-yellow-600/90 dark:text-yellow-500/90">
            Ursache: {data.detail}
          </span>
        )}
      </div>
    )
  }

  if (data?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">Kein Zugriff in Proxmox</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Der konfigurierte Viewer-Token hat kein Leserecht auf /cluster/backup.
        </p>
      </div>
    )
  }

  const jobs = data?.jobs ?? []

  return (
    <div className="space-y-3">
      {/* Datacenter-hint + action button */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          Datacenter-weite Backup-Jobs – identisch auf allen Mitglieds-Nodes desselben Clusters.
        </p>
        <button
          onClick={() => { setActionError(''); setFormJob(null) }}
          className="btn-primary shrink-0"
        >
          + Backup-Job anlegen
        </button>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">Schließen</button>
        </div>
      )}

      {/* Run-now result */}
      {runResult && (
        <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          <strong>{runResult.tasks?.length ?? 0} Backup-Task(s) gestartet.</strong>{' '}
          Fortschritt im Tab &bdquo;Ereignisse&ldquo; / &bdquo;Backups&ldquo; verfolgen.
          <ul className="mt-1 text-xs space-y-0.5">
            {(runResult.tasks ?? []).map((t, i) => (
              <li key={i}>
                <span className="font-mono">{t.node}</span>: UPID <span className="font-mono text-[10px]">{t.upid}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => setRunResult(null)} className="mt-1 underline text-xs">Schließen</button>
        </div>
      )}

      {/* Empty state */}
      {jobs.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400 dark:text-zinc-500">
          Keine geplanten Backup-Jobs in dieser Proxmox-Installation.
        </div>
      )}

      {/* Job table */}
      {jobs.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">ID</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Zeitplan</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Storage</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Ziel</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Modus</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Aufbew.</th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Aktiv</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {jobs.map(job => {
                  const hint = scheduleHint(job.schedule)
                  const toggling = togglingId === job.id
                  return (
                    <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                      <td className="px-3 py-2.5 text-[11px] font-mono text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        {job.id}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-medium text-gray-800 dark:text-zinc-200">
                          {job.schedule}
                        </span>
                        {hint && (
                          <span className="block text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
                            {hint}
                          </span>
                        )}
                        {job.comment && (
                          <span className="block text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 truncate max-w-[140px]" title={job.comment}>
                            {job.comment}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300 whitespace-nowrap">
                        {job.storage}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300 max-w-[160px] truncate" title={vmSelLabel(job)}>
                        {vmSelLabel(job)}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        <span className="capitalize">{job.mode}</span>
                        {job.compress && job.compress !== '0' && (
                          <span className="block text-[10px] text-gray-400 dark:text-zinc-500">{job.compress}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        {retentionLabel(job.retention)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => handleToggleEnabled(job)}
                          disabled={toggling}
                          title={job.enabled ? 'Aktiv – klicken zum Deaktivieren' : 'Inaktiv – klicken zum Aktivieren'}
                          className={`w-8 h-5 rounded-full transition-colors focus:outline-none ${
                            toggling ? 'opacity-40 cursor-not-allowed' :
                            job.enabled
                              ? 'bg-green-500 hover:bg-green-600'
                              : 'bg-gray-300 dark:bg-zinc-600 hover:bg-gray-400'
                          }`}
                          aria-label={job.enabled ? 'Aktiv' : 'Inaktiv'}
                        >
                          <span
                            className={`block w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform mx-0.5 ${
                              job.enabled ? 'translate-x-3' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <JobActions
                          job={job}
                          onEdit={j => { setActionError(''); setFormJob(j) }}
                          onDelete={j => { setActionError(''); setDeleteJob(j); setRunResult(null) }}
                          onRun={j => { setActionError(''); setRunJob(j); setRunResult(null) }}
                          busy={toggling}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form modal: create (formJob===null) or edit (formJob===object) */}
      {formJob !== undefined && (
        <BackupJobFormModal
          node={nodeName}
          job={formJob}
          onClose={() => setFormJob(undefined)}
          onSuccess={() => { setFormJob(undefined); load() }}
        />
      )}

      {/* Delete confirm modal */}
      {deleteJob && (
        <ConfirmModal
          title="Backup-Job löschen"
          body={
            <>
              <p>Job <strong className="font-mono">{deleteJob.id}</strong> wirklich löschen?</p>
              <p className="mt-2 text-xs text-gray-400 dark:text-zinc-500">
                Nur der Zeitplan wird entfernt – vorhandene Backup-Dateien bleiben erhalten.
              </p>
            </>
          }
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteJob(null)}
        />
      )}

      {/* Run-now confirm modal */}
      {runJob && !runResult && (
        <ConfirmModal
          title="Backup jetzt starten"
          body={
            <>
              <p>Job <strong className="font-mono">{runJob.id}</strong> sofort ausführen?</p>
              <p className="mt-2 text-xs text-yellow-600 dark:text-yellow-400">
                ⚠ Dies kann je nach VM-Anzahl kurzzeitig erhöhte I/O- und Netzwerklast erzeugen.
              </p>
            </>
          }
          confirmLabel="Jetzt sichern"
          variant="primary"
          onConfirm={handleRunConfirm}
          onClose={() => setRunJob(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
