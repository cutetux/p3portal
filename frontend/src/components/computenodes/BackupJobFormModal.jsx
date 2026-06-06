// p3portal.org
/**
 * PROJ-78: Modal for creating or editing a Proxmox datacenter-wide backup job.
 * Handles all four VM-selection modes: all, vmids, pool, all-except-exclusion.
 */
import { useState, useEffect } from 'react'
import { createBackupJob, updateBackupJob, listBackupJobPools, listBackupJobStorages } from '../../api/backupJobs'
import BackupSchedulePicker from './BackupSchedulePicker'
import VmMultiSelect from './VmMultiSelect'

const MODE_OPTIONS = [
  { value: 'snapshot', label: 'Snapshot (VM läuft weiter)' },
  { value: 'stop',     label: 'Stop (VM wird gestoppt)' },
  { value: 'suspend',  label: 'Suspend (VM wird pausiert)' },
]

const COMPRESS_OPTIONS = [
  { value: 'zstd', label: 'zstd (Standard, schnell)' },
  { value: 'lzo',  label: 'lzo (schnell, weniger Kompression)' },
  { value: 'gzip', label: 'gzip (langsam, beste Kompression)' },
  { value: '0',    label: 'Keine Kompression' },
]

// VM-selection modes
const VM_SEL_MODES = [
  { value: 'all',     label: 'Alle Gäste' },
  { value: 'vmids',   label: 'Bestimmte VMIDs' },
  { value: 'pool',    label: 'Pool' },
  { value: 'exclude', label: 'Alle außer Ausschluss' },
]

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Keine Berechtigung für Backup-Job-Verwaltung (fehlende Proxmox-Privilegien).'
  if (s === 503) return 'Admin-Service-Account für diese Node nicht konfiguriert.'
  if (s === 422) return (typeof d === 'string' ? d : 'Ungültige Parameter – bitte Eingaben prüfen.')
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Speichern des Backup-Jobs.'
}

/** Build initial form state from an existing job (edit) or defaults (create). */
function buildInitialState(job) {
  if (!job) {
    return {
      schedule: '02:00',  // matches BackupSchedulePicker default (daily 02:00)
      storage: '',
      mode: 'snapshot',
      compress: 'zstd',
      enabled: true,
      comment: '',
      mailto: '',
      vmSelMode: 'all',
      vmids: '',
      pool: '',
      exclude: '',
      keepLast: '',
      keepDaily: '',
      keepWeekly: '',
      keepMonthly: '',
    }
  }

  // Detect VM-selection mode from existing job
  let vmSelMode = 'all'
  if (job.vmid) vmSelMode = 'vmids'
  else if (job.pool) vmSelMode = 'pool'
  else if (job.all && job.exclude) vmSelMode = 'exclude'
  else if (job.all) vmSelMode = 'all'

  const ret = job.retention ?? {}
  return {
    schedule:   job.schedule   ?? '',
    storage:    job.storage    ?? '',
    mode:       job.mode       ?? 'snapshot',
    compress:   job.compress   ?? 'zstd',
    enabled:    job.enabled    ?? true,
    comment:    job.comment    ?? '',
    mailto:     job.mailto     ?? '',
    vmSelMode,
    vmids:      job.vmid       ?? '',
    pool:       job.pool       ?? '',
    exclude:    job.exclude    ?? '',
    keepLast:   ret.keep_last    != null ? String(ret.keep_last)    : '',
    keepDaily:  ret.keep_daily   != null ? String(ret.keep_daily)   : '',
    keepWeekly: ret.keep_weekly  != null ? String(ret.keep_weekly)  : '',
    keepMonthly:ret.keep_monthly != null ? String(ret.keep_monthly) : '',
  }
}

/** Convert form state to BackupJobCreateRequest/UpdateRequest payload. */
function buildPayload(form) {
  const retention = {}
  if (form.keepLast    !== '') retention.keep_last    = parseInt(form.keepLast,    10)
  if (form.keepDaily   !== '') retention.keep_daily   = parseInt(form.keepDaily,   10)
  if (form.keepWeekly  !== '') retention.keep_weekly  = parseInt(form.keepWeekly,  10)
  if (form.keepMonthly !== '') retention.keep_monthly = parseInt(form.keepMonthly, 10)

  const payload = {
    schedule:  form.schedule.trim(),
    storage:   form.storage.trim(),
    mode:      form.mode,
    compress:  form.compress,
    enabled:   form.enabled,
    comment:   form.comment.trim(),
    mailto:    form.mailto.trim(),
    all_vms:   false,
    vmids:     '',
    pool:      '',
    exclude:   '',
    retention,
  }

  if (form.vmSelMode === 'all') {
    payload.all_vms = true
  } else if (form.vmSelMode === 'vmids') {
    payload.vmids = form.vmids.trim()
  } else if (form.vmSelMode === 'pool') {
    payload.pool = form.pool.trim()
  } else if (form.vmSelMode === 'exclude') {
    payload.all_vms = true
    payload.exclude = form.exclude.trim()
  }

  return payload
}

const inputCls  = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded'
const labelCls  = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls  = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls  = 'space-y-1'

export default function BackupJobFormModal({ node, job, onClose, onSuccess }) {
  const isEdit = Boolean(job)
  const [form, setForm]       = useState(() => buildInitialState(job))
  const [pools, setPools]     = useState([])
  const [storages, setStorages] = useState([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Fetch pool list for Pool-selection mode
  useEffect(() => {
    if (!node) return
    listBackupJobPools(node)
      .then(data => setPools(data ?? []))
      .catch(() => setPools([]))
  }, [node])

  // Fetch backup-capable storages for the Storage dropdown
  useEffect(() => {
    if (!node) return
    listBackupJobStorages(node)
      .then(data => setStorages(data ?? []))
      .catch(() => setStorages([]))
  }, [node])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setBool = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))
  const setVal = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.schedule.trim()) { setError('Zeitplan ist Pflichtfeld.'); return }
    if (!form.storage.trim())  { setError('Storage ist Pflichtfeld.'); return }
    if (form.vmSelMode === 'vmids' && !form.vmids.trim()) {
      setError('Bitte mindestens eine VMID eingeben.'); return
    }
    if (form.vmSelMode === 'pool' && !form.pool.trim()) {
      setError('Bitte einen Pool auswählen.'); return
    }

    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      if (isEdit) {
        await updateBackupJob(node, job.id, payload)
      } else {
        await createBackupJob(node, payload)
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-2xl rounded-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-job-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="backup-job-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? `Backup-Job bearbeiten – ${job.id}` : 'Backup-Job anlegen'}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form id="backup-job-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Schedule */}
          <div className={fieldCls}>
            <BackupSchedulePicker
              label="Zeitplan"
              value={form.schedule}
              onChange={setVal('schedule')}
            />
          </div>

          {/* Storage */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="bj-storage">Storage <span className="text-red-400">*</span></label>
            {storages.length > 0 ? (
              <select id="bj-storage" value={form.storage} onChange={set('storage')} className={inputCls}>
                <option value="">– Storage auswählen –</option>
                {storages.map(s => {
                  const sid = s.storage ?? s
                  return (
                    <option key={sid} value={sid}>
                      {sid}{s.type ? ` (${s.type})` : ''}
                    </option>
                  )
                })}
                {/* Keep an unknown existing value selectable on edit */}
                {form.storage && !storages.some(s => (s.storage ?? s) === form.storage) && (
                  <option value={form.storage}>{form.storage} (nicht in Liste)</option>
                )}
              </select>
            ) : (
              <input
                id="bj-storage"
                type="text"
                value={form.storage}
                onChange={set('storage')}
                placeholder="z.B. local, nas-backup"
                className={inputCls}
              />
            )}
            <p className={smallCls}>Backup-fähiger Ziel-Storage</p>
          </div>

          {/* VM-Auswahl */}
          <div className={fieldCls}>
            <label className={labelCls}>VM-Auswahl <span className="text-red-400">*</span></label>
            <div className="flex gap-2 flex-wrap">
              {VM_SEL_MODES.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, vmSelMode: m.value }))}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    form.vmSelMode === m.value
                      ? 'bg-orange-500 border-orange-500 text-white'
                      : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-orange-400'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Conditional sub-inputs */}
            {form.vmSelMode === 'vmids' && (
              <div className="mt-2">
                <VmMultiSelect
                  pveNode={node}
                  value={form.vmids}
                  onChange={setVal('vmids')}
                  emptyHint="Keine VMs/LXCs gefunden – ggf. VMIDs manuell im Pool/Exclude-Modus pflegen."
                />
              </div>
            )}
            {form.vmSelMode === 'pool' && (
              <div className="mt-2">
                {pools.length > 0 ? (
                  <select value={form.pool} onChange={set('pool')} className={inputCls}>
                    <option value="">– Pool auswählen –</option>
                    {pools.map(p => (
                      <option key={p.poolid ?? p} value={p.poolid ?? p}>
                        {p.poolid ?? p}{p.comment ? ` – ${p.comment}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={form.pool}
                    onChange={set('pool')}
                    placeholder="Pool-Name"
                    className={inputCls}
                  />
                )}
              </div>
            )}
            {form.vmSelMode === 'exclude' && (
              <div className="mt-2">
                <p className={`${smallCls} mb-2`}>Alle Gäste werden gesichert – die hier markierten ausgenommen:</p>
                <VmMultiSelect
                  pveNode={node}
                  value={form.exclude}
                  onChange={setVal('exclude')}
                  emptyHint="Keine VMs/LXCs gefunden."
                />
              </div>
            )}
          </div>

          {/* Row: Mode + Compress */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-mode">Backup-Modus</label>
              <select id="bj-mode" value={form.mode} onChange={set('mode')} className={inputCls}>
                {MODE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-compress">Kompression</label>
              <select id="bj-compress" value={form.compress} onChange={set('compress')} className={inputCls}>
                {COMPRESS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Retention */}
          <div>
            <p className={labelCls}>Aufbewahrung (leer = nicht gesetzt)</p>
            <div className="grid grid-cols-4 gap-3">
              {[
                { key: 'keepLast',    label: 'Letzten N', id: 'bj-keep-last'    },
                { key: 'keepDaily',   label: 'Täglich',   id: 'bj-keep-daily'   },
                { key: 'keepWeekly',  label: 'Wöchentl.', id: 'bj-keep-weekly'  },
                { key: 'keepMonthly', label: 'Monatl.',   id: 'bj-keep-monthly' },
              ].map(({ key, label, id }) => (
                <div key={key} className={fieldCls}>
                  <label className={labelCls} htmlFor={id}>{label}</label>
                  <input
                    id={id}
                    type="number"
                    min="0"
                    value={form[key]}
                    onChange={set(key)}
                    placeholder="–"
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Mail + Comment */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-mailto">E-Mail (optional)</label>
              <input
                id="bj-mailto"
                type="text"
                value={form.mailto}
                onChange={set('mailto')}
                placeholder="admin@example.com"
                className={inputCls}
              />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-comment">Kommentar (optional)</label>
              <input
                id="bj-comment"
                type="text"
                value={form.comment}
                onChange={set('comment')}
                placeholder="z.B. Nachtliches Backup"
                className={inputCls}
              />
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <input
              id="bj-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={setBool('enabled')}
              className="w-4 h-4 rounded accent-orange-500"
            />
            <label htmlFor="bj-enabled" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              Job aktiv (Zeitplan ausführen)
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Abbrechen
          </button>
          <button type="submit" form="backup-job-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? 'Speichern' : 'Job anlegen'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
