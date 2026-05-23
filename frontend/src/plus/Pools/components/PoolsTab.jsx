// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: "Meine Pools" Tab im Nutzerprofil (AC-31, AC-34).
import { useTranslation } from 'react-i18next'
import { useMyPools } from '../hooks/useMyPools'

export default function PoolsTab() {
  const { t }          = useTranslation()
  const { pools, loading } = useMyPools()

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-8 text-center">
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('common.loading')}</p>
      </div>
    )
  }

  if (!pools || pools.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-8 text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('pools.profile_empty')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pools.map(p => (
        <div
          key={p.id}
          className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-4 py-3 flex items-center justify-between"
        >
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{p.name}</p>
            {p.role_preset_name && (
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                {t('pools.profile_preset_label')}: {p.role_preset_name}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
