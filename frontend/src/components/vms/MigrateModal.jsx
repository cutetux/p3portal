// p3portal.org
// PROJ-102: Migrate-Modal (VM/LXC). Offline-Migration auf eine andere Node
// desselben Clusters. Ziel-Nodes = cluster_nodes ohne die aktuelle; leere Liste
// → Single-Node → Hinweis. Optionaler Ziel-Storage. Läuft als Job → Live-Log.
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { migrateVm, getMigrationTargets } from '../../api/vms'
import { lifecycleErrMsg } from './lifecycleHelpers'
import { modalInputCls } from './disks/diskHelpers'
import { useHaAwarenessGuard, isHaCancelled } from './useHaAwarenessGuard'

export default function MigrateModal({ vm, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { guardedRun, haModal } = useHaAwarenessGuard()  // PROJ-103

  const [targets, setTargets] = useState(null)   // null = loading
  const [targetsErr, setTargetsErr] = useState('')
  const [form, setForm] = useState({ target_node: '', target_storage: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k, v) => { setError(''); setForm((f) => ({ ...f, [k]: v })) }

  useEffect(() => {
    let active = true
    setTargets(null)
    setTargetsErr('')
    getMigrationTargets(vm.vmid, vm.node)
      .then((res) => {
        if (!active) return
        setTargets(res.targets || [])
        if ((res.targets || []).length > 0) setForm((f) => ({ ...f, target_node: res.targets[0] }))
      })
      .catch((err) => { if (active) { setTargets([]); setTargetsErr(lifecycleErrMsg(err, t)) } })
    return () => { active = false }
  }, [vm.vmid, vm.node, t])

  const submit = async (e) => {
    e.preventDefault()
    if (!form.target_node) { setError(t('vm_lifecycle.migrate_select_target')); return }
    const body = { target_node: form.target_node }
    if (form.target_storage.trim()) body.target_storage = form.target_storage.trim()
    setBusy(true)
    setError('')
    try {
      // PROJ-103: HA-Awareness (409 ha_managed → fortsetzbarer Dialog → confirm).
      const job = await guardedRun(
        (confirm) => migrateVm(vm.vmid, body, vm.node, { confirm }),
        t('vm_lifecycle.migrate_submit'),
      )
      onClose?.()
      navigate(`/events/${job.id}`)
    } catch (err) {
      if (isHaCancelled(err)) { setBusy(false); return }  // Warndialog abgebrochen → kein Fehler
      setError(lifecycleErrMsg(err, t))
      setBusy(false)
    }
  }

  const noTargets = Array.isArray(targets) && targets.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg flex flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('vm_lifecycle.migrate_title', { name: vm.name || vm.vmid })}
          </h2>
          <button onClick={onClose} aria-label={t('vm_lifecycle.close')} className="btn-ghost">✕</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</p>
          )}

          {targets == null ? (
            <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-2">{t('vm_lifecycle.migrate_targets_loading')}</p>
          ) : noTargets ? (
            <p className="text-sm text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 px-3 py-2 rounded">
              {t('vm_lifecycle.migrate_no_targets')}
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="mig-node" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
                  {t('vm_lifecycle.migrate_target_label')}
                </label>
                <select id="mig-node" value={form.target_node}
                  onChange={(e) => set('target_node', e.target.value)} className={modalInputCls}>
                  {targets.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="mig-storage" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
                  {t('vm_lifecycle.migrate_storage_label')}
                </label>
                <input id="mig-storage" type="text" value={form.target_storage}
                  placeholder={t('vm_lifecycle.migrate_storage_ph')}
                  onChange={(e) => set('target_storage', e.target.value)} className={`${modalInputCls} font-mono`} />
                <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">{t('vm_lifecycle.migrate_storage_hint')}</p>
              </div>
            </>
          )}
          {targetsErr && <p className="text-xs text-portal-danger">{targetsErr}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('vm_lifecycle.cancel')}</button>
            <button type="submit" disabled={busy || noTargets || targets == null} className="btn-primary">
              {busy ? t('vm_lifecycle.migrate_submitting') : t('vm_lifecycle.migrate_submit')}
            </button>
          </div>
        </form>
        <span className="rq hidden" aria-hidden="true" />
      </div>
      {haModal}
    </div>
  )
}
