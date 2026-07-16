// p3portal.org
// PROJ-102: Convert-to-Template-Modal (VM/LXC). Nur bei gestopptem Gast; danger-
// Sicherheitsabfrage, da (im MVP) nicht ohne Weiteres rückgängig. Läuft als
// Job → nach Erfolg Navigation in den Live-Log (/events/:id).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { convertToTemplate } from '../../api/vms'
import { lifecycleErrMsg } from './lifecycleHelpers'
import { useHaAwarenessGuard, isHaCancelled } from './useHaAwarenessGuard'

export default function ConvertTemplateModal({ vm, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { guardedRun, haModal } = useHaAwarenessGuard()  // PROJ-103
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      // PROJ-103: HA-Awareness (409 ha_managed → fortsetzbarer Dialog → confirm).
      const job = await guardedRun(
        (confirm) => convertToTemplate(vm.vmid, vm.node, { confirm }),
        t('vm_lifecycle.convert_submit'),
      )
      onClose?.()
      navigate(`/events/${job.id}`)
    } catch (err) {
      if (isHaCancelled(err)) { setBusy(false); return }
      setError(lifecycleErrMsg(err, t))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg flex flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('vm_lifecycle.convert_title', { name: vm.name || vm.vmid })}
          </h2>
          <button onClick={onClose} aria-label={t('vm_lifecycle.close')} className="btn-ghost">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</p>
          )}

          <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-3 rounded">
            <p className="text-sm font-medium text-portal-danger mb-1">{t('vm_lifecycle.convert_warn_title')}</p>
            <p className="text-xs text-gray-700 dark:text-zinc-300">{t('vm_lifecycle.convert_warn_body')}</p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary">{t('vm_lifecycle.cancel')}</button>
            <button type="button" onClick={submit} disabled={busy} className="btn-danger">
              {busy ? t('vm_lifecycle.convert_submitting') : t('vm_lifecycle.convert_submit')}
            </button>
          </div>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
      {haModal}
    </div>
  )
}
