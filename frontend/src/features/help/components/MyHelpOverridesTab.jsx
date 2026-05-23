// p3portal.org
// PROJ-57: MyAccount-Tab „Meine Hilfetexte" – eigene Overrides verwalten und löschen.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHelpOverridesMe, useDeleteOverride } from '../hooks'
import { REGISTRY_MAP } from '../registry'
import ConfirmModal from '../../../components/common/ConfirmModal'

export default function MyHelpOverridesTab() {
  const { t } = useTranslation()
  const { data: overrides = [], isLoading, error } = useHelpOverridesMe()
  const deleteOverride = useDeleteOverride()
  const [confirmId, setConfirmId] = useState(null)

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <p className="text-sm text-portal-danger">{t('common.load_error')}</p>
      </div>
    )
  }

  const handleDelete = async () => {
    if (!confirmId) return
    await deleteOverride.mutateAsync(confirmId)
    setConfirmId(null)
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6 space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
          {t('help.my_overrides_tab_title')}
        </p>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
          {t('help.my_overrides_desc', { count: overrides.length })}
        </p>
      </div>

      {overrides.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-zinc-500">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 mx-auto mb-2 opacity-40">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1" ry="1"/>
          </svg>
          <p className="text-sm">{t('help.my_overrides_empty')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-zinc-400">{t('help.admin.col_key')}</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-zinc-400">{t('help.admin.col_lang')}</th>
                <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-zinc-400">{t('help.admin.col_date')}</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {overrides.map(o => {
                const regEntry = REGISTRY_MAP[o.key]
                return (
                  <tr key={o.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                    <td className="py-2 px-3">
                      <span className="font-mono text-gray-700 dark:text-zinc-300">{o.key}</span>
                      {regEntry && (
                        <span className="ml-2 text-gray-400 dark:text-zinc-500">({regEntry.titleDe})</span>
                      )}
                    </td>
                    <td className="py-2 px-3 uppercase text-gray-500">{o.lang}</td>
                    <td className="py-2 px-3 text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                      {new Date(o.updated_at).toLocaleDateString('de-DE')}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => setConfirmId(o.id)}
                        className="btn-table-danger"
                        disabled={deleteOverride.isPending}
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmId && (
        <ConfirmModal
          isOpen
          title={t('help.reset_to_default')}
          message={t('help.reset_confirm_message')}
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmId(null)}
          busy={deleteOverride.isPending}
        />
      )}
    </div>
  )
}
