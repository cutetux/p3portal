// p3portal.org
// PROJ-102: Clone-Modal (VM/LXC). Full-Clone immer; Linked-Clone nur wenn die
// Quelle ein Template ist. Optionale Ziel-VMID (leer = auto next-free), Ziel-
// Storage (QEMU=image / LXC=rootdir) und „mich als Owner setzen" (Default AN).
// Läuft als Job → nach Erfolg Navigation in den Live-Log (/events/:id).
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { cloneVm, listImageStorages, listRootdirStorages } from '../../api/vms'
import { lifecycleErrMsg } from './lifecycleHelpers'
import { modalInputCls, formatBytes } from './disks/diskHelpers'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/

export default function CloneModal({ vm, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isLxc = vm.type === 'lxc'
  const isTemplate = !!vm.is_template

  const [storages, setStorages] = useState(null)   // null = loading
  const [storagesErr, setStoragesErr] = useState('')
  const [form, setForm] = useState({
    name: `${vm.name || vm.vmid}-clone`,
    target_storage: '',
    newid: '',
    full: true,
    set_owner: true,
  })
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k, v) => { setError(''); setNameError(''); setForm((f) => ({ ...f, [k]: v })) }

  useEffect(() => {
    let active = true
    setStorages(null)
    setStoragesErr('')
    const loader = isLxc ? listRootdirStorages : listImageStorages
    loader(vm.node)
      .then((rows) => { if (active) setStorages(rows) })
      .catch((err) => { if (active) { setStorages([]); setStoragesErr(lifecycleErrMsg(err, t)) } })
    return () => { active = false }
  }, [vm.node, isLxc, t])

  const submit = async (e) => {
    e.preventDefault()
    if (!NAME_RE.test(form.name.trim())) {
      setNameError(t('vm_lifecycle.clone_name_invalid'))
      return
    }
    const body = {
      name: form.name.trim(),
      full: form.full,
      set_owner: form.set_owner,
    }
    if (form.target_storage) body.target_storage = form.target_storage
    const nid = form.newid.trim()
    if (nid) {
      const n = parseInt(nid, 10)
      if (Number.isNaN(n) || n < 100) { setError(t('vm_lifecycle.clone_vmid_invalid')); return }
      body.newid = n
    }
    setBusy(true)
    setError('')
    try {
      const job = await cloneVm(vm.vmid, body, vm.node)
      onClose?.()
      navigate(`/events/${job.id}`)
    } catch (err) {
      setError(lifecycleErrMsg(err, t))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('vm_lifecycle.clone_title', { name: vm.name || vm.vmid })}
          </h2>
          <button onClick={onClose} aria-label={t('vm_lifecycle.close')} className="btn-ghost">✕</button>
        </div>

        <form onSubmit={submit} className="overflow-y-auto flex-1 p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</p>
          )}

          {/* Name */}
          <div>
            <label htmlFor="clone-name" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
              {isLxc ? t('vm_lifecycle.clone_hostname_label') : t('vm_lifecycle.clone_name_label')}
            </label>
            <input id="clone-name" type="text" value={form.name}
              onChange={(e) => set('name', e.target.value)} className={`${modalInputCls} font-mono`} />
            {nameError && <p className="mt-1 text-xs text-portal-danger">{nameError}</p>}
          </div>

          {/* Clone mode */}
          <div>
            <span className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('vm_lifecycle.clone_mode_label')}</span>
            <div className="flex items-center gap-4 text-sm text-gray-800 dark:text-zinc-200">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="clone-mode" checked={form.full} onChange={() => set('full', true)} />
                {t('vm_lifecycle.clone_mode_full')}
              </label>
              <label className={`inline-flex items-center gap-1.5 ${isTemplate ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
                <input type="radio" name="clone-mode" disabled={!isTemplate}
                  checked={!form.full} onChange={() => set('full', false)} />
                {t('vm_lifecycle.clone_mode_linked')}
              </label>
            </div>
            {!isTemplate && (
              <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">{t('vm_lifecycle.clone_linked_hint')}</p>
            )}
          </div>

          {/* Target storage (only for full clone) */}
          {form.full && (
            <div>
              <label htmlFor="clone-storage" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
                {t('vm_lifecycle.clone_storage_label')}
              </label>
              {storages == null ? (
                <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-2">{t('vm_lifecycle.storage_loading')}</p>
              ) : (
                <select id="clone-storage" value={form.target_storage}
                  onChange={(e) => set('target_storage', e.target.value)} className={modalInputCls}>
                  <option value="">{t('vm_lifecycle.clone_storage_default')}</option>
                  {storages.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({formatBytes(s.avail)} {t('vm_lifecycle.storage_free')} / {formatBytes(s.total)})
                    </option>
                  ))}
                </select>
              )}
              {storagesErr && <p className="mt-1 text-xs text-portal-danger">{storagesErr}</p>}
            </div>
          )}

          {/* Optional VMID */}
          <div>
            <label htmlFor="clone-vmid" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
              {t('vm_lifecycle.clone_vmid_label')}
            </label>
            <input id="clone-vmid" type="number" min="100" value={form.newid}
              placeholder={t('vm_lifecycle.clone_vmid_ph')}
              onChange={(e) => set('newid', e.target.value)} className={`${modalInputCls} font-mono`} />
            <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">{t('vm_lifecycle.clone_vmid_hint')}</p>
          </div>

          {/* Owner */}
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-zinc-200 cursor-pointer">
            <input type="checkbox" checked={form.set_owner} onChange={(e) => set('set_owner', e.target.checked)} />
            {t('vm_lifecycle.clone_set_owner')}
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('vm_lifecycle.cancel')}</button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? t('vm_lifecycle.clone_submitting') : t('vm_lifecycle.clone_submit')}
            </button>
          </div>
        </form>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
