// p3portal.org
// PROJ-103: HA-Ressource hinzufügen / bearbeiten. Beim Anlegen wird die SID aus
// Typ (vm/ct) + VMID zusammengesetzt; beim Bearbeiten ist die SID fest. Soll-
// Zustand, max_restart, max_relocate, failback, Kommentar. Config-CRUD synchron.
// PVE-9-Pivot: das alte `group`-Feld entfällt (Zuordnung erfolgt über node-affinity
// Regeln); stattdessen optional `failback`.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createHaResource, updateHaResource } from '../../api/ha'
import { haErrMsg } from './haHelpers'
import { modalInputCls } from '../vms/disks/diskHelpers'

const STATES = ['started', 'stopped', 'disabled', 'ignored', 'enabled']

export default function HaResourceFormModal({ resource, portalNodeId = null, onClose, onSuccess }) {
  const { t } = useTranslation()
  const isEdit = Boolean(resource)
  const [kind, setKind] = useState('vm')
  const [vmid, setVmid] = useState('')
  const [state, setState] = useState(resource?.state ?? 'started')
  const [maxRestart, setMaxRestart] = useState(resource?.max_restart ?? '')
  const [maxRelocate, setMaxRelocate] = useState(resource?.max_relocate ?? '')
  const [failback, setFailback] = useState(resource?.failback ?? true)
  const [comment, setComment] = useState(resource?.comment ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    let sid = resource?.sid
    if (!isEdit) {
      const id = String(vmid).trim()
      if (!/^\d+$/.test(id)) { setError(t('ha.resource.err_vmid')); return }
      sid = `${kind}:${id}`
    }
    const payload = { sid, state }
    if (maxRestart !== '') payload.max_restart = Number(maxRestart)
    if (maxRelocate !== '') payload.max_relocate = Number(maxRelocate)
    payload.failback = Boolean(failback)
    if (comment.trim()) payload.comment = comment.trim()

    setBusy(true)
    setError('')
    try {
      if (isEdit) await updateHaResource(resource.sid, payload, portalNodeId)
      else await createHaResource(payload, portalNodeId)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(haErrMsg(err, t))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg flex flex-col rounded-lg max-h-[88vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('ha.resource.edit_title', { sid: resource.sid }) : t('ha.resource.create_title')}
          </h2>
          <button onClick={onClose} aria-label={t('ha.close')} className="btn-ghost">✕</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          {error && <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</p>}

          {isEdit ? (
            <div>
              <label className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.sid_label')}</label>
              <p className="font-mono text-sm text-gray-900 dark:text-zinc-100">{resource.sid}</p>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div>
                <label htmlFor="ha-res-kind" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.kind_label')}</label>
                <select id="ha-res-kind" value={kind} onChange={(e) => { setError(''); setKind(e.target.value) }} className={`${modalInputCls} w-24`}>
                  <option value="vm">vm</option>
                  <option value="ct">ct</option>
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="ha-res-vmid" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.vmid_label')}</label>
                <input id="ha-res-vmid" type="number" min="100" value={vmid}
                  onChange={(e) => { setError(''); setVmid(e.target.value) }}
                  placeholder="100" className={`${modalInputCls} font-mono`} />
              </div>
            </div>
          )}

          <div>
            <label htmlFor="ha-res-state" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.state_label')}</label>
            <select id="ha-res-state" value={state} onChange={(e) => setState(e.target.value)} className={modalInputCls}>
              {STATES.map((s) => <option key={s} value={s}>{t(`ha.resource.state_${s}`)}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ha-res-restart" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.max_restart_label')}</label>
              <input id="ha-res-restart" type="number" min="0" max="100" value={maxRestart}
                onChange={(e) => setMaxRestart(e.target.value)} placeholder="1" className={modalInputCls} />
            </div>
            <div>
              <label htmlFor="ha-res-relocate" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.max_relocate_label')}</label>
              <input id="ha-res-relocate" type="number" min="0" max="100" value={maxRelocate}
                onChange={(e) => setMaxRelocate(e.target.value)} placeholder="1" className={modalInputCls} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-zinc-300">
            <input type="checkbox" checked={failback} onChange={(e) => setFailback(e.target.checked)} />
            {t('ha.resource.failback_label')}
          </label>

          <div>
            <label htmlFor="ha-res-comment" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.resource.comment_label')}</label>
            <input id="ha-res-comment" type="text" value={comment} onChange={(e) => setComment(e.target.value)} className={modalInputCls} />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('ha.cancel')}</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? t('ha.saving') : isEdit ? t('ha.save') : t('ha.resource.add')}
            </button>
          </div>
        </form>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
