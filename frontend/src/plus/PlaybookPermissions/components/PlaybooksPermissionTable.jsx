// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Tabelle aller Playbooks mit Modus-Badge + Bearbeiten-Button.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EditPermissionsModal from './EditPermissionsModal'

function ModeBadge({ playbook, defaultMode }) {
  const { t } = useTranslation()
  const count = playbook.permission_count ?? 0

  if (count > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
        </svg>
        {t('playbook_permissions.mode_whitelist', { count })}
      </span>
    )
  }

  if (defaultMode === 'restricted') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {t('playbook_permissions.mode_restricted')}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
      </svg>
      {t('playbook_permissions.mode_open')}
    </span>
  )
}

export default function PlaybooksPermissionTable({ playbooks, defaultMode, loading }) {
  const { t } = useTranslation()
  const [editPlaybook, setEditPlaybook] = useState(null)

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-14 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (!playbooks || playbooks.length === 0) {
    return (
      <div className="flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-xl px-6 py-12 text-sm text-gray-400 dark:text-zinc-500">
        {t('playbook_permissions.no_playbooks')}
      </div>
    )
  }

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-zinc-800">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                {t('playbook_permissions.col_name')}
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider hidden sm:table-cell">
                {t('playbook_permissions.col_category')}
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                {t('playbook_permissions.col_mode')}
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider hidden md:table-cell">
                {t('playbook_permissions.col_subjects')}
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            {playbooks.map(pb => (
              <tr key={pb.id ?? pb.name} className="hover:bg-gray-50 dark:hover:bg-zinc-950/50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-800 dark:text-zinc-200 truncate max-w-[200px]">
                    {pb.name}
                  </p>
                </td>
                <td className="px-4 py-3 hidden sm:table-cell">
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    {pb.category ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <ModeBadge playbook={pb} defaultMode={defaultMode} />
                </td>
                <td className="px-4 py-3 hidden md:table-cell">
                  <span className="text-xs text-gray-500 dark:text-zinc-400">
                    {pb.permission_count ?? 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditPlaybook(pb)}
                    className="btn-table"
                  >
                    {t('playbook_permissions.edit')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editPlaybook && (
        <EditPermissionsModal
          playbook={editPlaybook}
          onClose={() => setEditPlaybook(null)}
        />
      )}
    </>
  )
}
