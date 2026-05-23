// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Profil-Sektion „Erlaubte Playbooks" in PermissionsPage.
// Zeigt alle Playbooks, die der User ausführen darf + Source-Badge.
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMyPlaybookPermissions } from '../hooks'

function SourceBadge({ source }) {
  const { t } = useTranslation()

  if (source === 'admin') {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
        {t('playbook_permissions.source_admin')}
      </span>
    )
  }
  if (source === 'direct') {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
        {t('playbook_permissions.source_direct')}
      </span>
    )
  }
  if (source === 'default_mode_open') {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700">
        {t('playbook_permissions.source_default_mode')}
      </span>
    )
  }
  if (source?.startsWith('group:')) {
    const groupName = source.replace('group:', '')
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
        {t('playbook_permissions.source_group', { group: groupName })}
      </span>
    )
  }
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
      {source}
    </span>
  )
}

export default function AllowedPlaybooksSection() {
  const { t } = useTranslation()
  const { allowed, loading } = useMyPlaybookPermissions()

  if (loading) {
    return (
      <div className="space-y-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (!allowed.length) {
    return (
      <p className="text-sm text-gray-500 dark:text-zinc-400">
        {t('playbook_permissions.profile_no_playbooks')}
      </p>
    )
  }

  return (
    <ul className="space-y-1">
      {allowed.map((entry, i) => (
        <li key={`${entry.playbook_name}-${i}`}>
          <Link
            to="/provisioning"
            className="flex items-center justify-between gap-2 px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-orange-300 dark:hover:border-orange-700 transition-colors rounded-lg"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-gray-800 dark:text-zinc-200 truncate">{entry.playbook_name}</span>
              {entry.category && (
                <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">
                  {t(`playbooks.category.${entry.category}`, { defaultValue: entry.category })}
                </span>
              )}
            </div>
            <SourceBadge source={entry.source} />
          </Link>
        </li>
      ))}
    </ul>
  )
}
