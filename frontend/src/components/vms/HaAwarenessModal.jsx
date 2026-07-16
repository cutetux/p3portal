// p3portal.org
// PROJ-103: HA-Awareness-Warnung. Rein Core: basiert ausschließlich auf dem
// HTTP-409-Vertrag der Lifecycle-/Power-Endpoints
// ({error:'ha_managed', action, sid, state, group}). Fährt der HA-Manager die
// betroffene VM/CT (Soll: started) ggf. wieder hoch bzw. arbeitet gegen die
// Aktion → warnen, nicht blockieren (PROJ-103 Leitentscheidung #6). Auf
// Standalone-/Nicht-HA-Installationen liefert das Backend nie diesen 409 → der
// Dialog erscheint nie. DE-Texte via i18n (Namespace vm_lifecycle.ha_*).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function HaAwarenessModal({ data, actionLabel, onConfirm, onCancel }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const sid = data?.sid || '?'
  const state = data?.state || 'started'
  const group = data?.group || null

  const handle = async () => {
    if (busy) return
    setBusy(true)
    // onConfirm wirft nie nach außen (resolved/rejected die ursprüngliche Aktion);
    // das Modal schließt danach über den Guard.
    await onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ha-aware-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="ha-aware-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('vm_lifecycle.ha_title')}
          </h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="rounded-md border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 space-y-1">
            <p className="text-sm text-gray-800 dark:text-zinc-200">
              {t('vm_lifecycle.ha_body', { sid, state })}
            </p>
            {group && (
              <p className="text-xs text-gray-500 dark:text-zinc-400">
                {t('vm_lifecycle.ha_group', { group })}
              </p>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            {actionLabel
              ? t('vm_lifecycle.ha_confirm_labeled', { action: actionLabel })
              : t('vm_lifecycle.ha_confirm')}
          </p>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            {t('vm_lifecycle.cancel')}
          </button>
          <button type="button" onClick={handle} disabled={busy} className="btn-danger">
            {busy ? '…' : t('vm_lifecycle.ha_proceed')}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
