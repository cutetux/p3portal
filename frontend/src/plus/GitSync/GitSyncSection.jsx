// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import PlusBadge from '../../components/common/PlusBadge'
import { useCapability } from '../../hooks/useCapability'
import GitSyncRepoPanel from './GitSyncRepoPanel'
import ConflictList from './ConflictList'
import { fetchConflicts } from './api'

export default function GitSyncSection() {
  const { t } = useTranslation()
  const canUseGitSync = useCapability('git_sync')
  const [conflicts, setConflicts] = useState([])
  const [conflictsLoading, setConflictsLoading] = useState(false)

  const loadConflicts = useCallback(async () => {
    if (!canUseGitSync) return
    setConflictsLoading(true)
    try {
      const all = await fetchConflicts()
      setConflicts(all)
    } catch {
      // ignore
    } finally {
      setConflictsLoading(false)
    }
  }, [canUseGitSync])

  useEffect(() => { loadConflicts() }, [loadConflicts])

  const openConflicts = conflicts.filter(c => !c.resolved_at)

  if (!canUseGitSync) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {t('git_sync.section_title')}
          </p>
          <PlusBadge />
        </div>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          {t('git_sync.plus_only_hint')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 flex items-center gap-2">
          {t('git_sync.section_title')}
          <PlusBadge />
        </h3>
      </div>

      <GitSyncRepoPanel repoType="ansible" onConflictsChange={loadConflicts} />
      <GitSyncRepoPanel repoType="packer" onConflictsChange={loadConflicts} />

      {!conflictsLoading && openConflicts.length > 0 && (
        <ConflictList
          conflicts={openConflicts}
          allConflicts={conflicts}
          onResolved={loadConflicts}
        />
      )}
    </div>
  )
}
