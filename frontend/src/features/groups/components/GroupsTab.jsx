// p3portal.org
// PROJ-45: "Meine Gruppen" Tab im Nutzerprofil (AC-22, AC-35).
import { useTranslation } from 'react-i18next'

export default function GroupsTab({ groups }) {
  const { t } = useTranslation()

  if (!groups || groups.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-8 text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('groups.profile_empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups.map(g => (
        <div
          key={g.id}
          className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-4 py-3 flex items-center justify-between"
        >
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{g.name}</p>
            {g.owner_username && (
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                {t('groups.profile_owner_label')}: {g.owner_username}
              </p>
            )}
          </div>
          <button
            type="button"
            disabled
            title={t('groups.profile_join_request_disabled')}
            className="text-xs text-gray-300 dark:text-zinc-600 cursor-not-allowed"
          >
            {t('groups.profile_join_request_disabled')}
          </button>
        </div>
      ))}
    </div>
  )
}
