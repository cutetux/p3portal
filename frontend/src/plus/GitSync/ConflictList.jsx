// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveConflict } from './api'
import { formatApiError } from '../../api/errors'

function ConflictItem({ conflict, onResolved }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(null) // 'git' | 'local' | null
  const [error, setError] = useState('')

  const handle = async (resolution) => {
    setLoading(resolution)
    setError('')
    try {
      await resolveConflict(conflict.id, resolution)
      onResolved()
    } catch (err) {
      setError(formatApiError(err))
      setLoading(null)
    }
  }

  const repoLabel = conflict.repo_type === 'ansible' ? t('git_sync.repo_ansible') : t('git_sync.repo_packer')

  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-zinc-800 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
              {repoLabel}
            </span>
            <span className="font-mono text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">
              {conflict.item_id}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
            {t('git_sync.conflict_detected')}: {new Date(conflict.detected_at).toLocaleString()}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-zinc-500 font-mono">
            {t('git_sync.conflict_git_hash')}: {conflict.git_hash.slice(0, 12)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => handle('local')}
            disabled={loading !== null}
            className="btn-secondary text-xs"
          >
            {loading === 'local' ? '…' : t('git_sync.conflict_keep_local')}
          </button>
          <button
            onClick={() => handle('git')}
            disabled={loading !== null}
            className="btn-primary text-xs"
          >
            {loading === 'git' ? '…' : t('git_sync.conflict_use_git')}
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

export default function ConflictList({ conflicts, allConflicts, onResolved }) {
  const { t } = useTranslation()
  const [showResolved, setShowResolved] = useState(false)

  const resolvedConflicts = allConflicts.filter(c => c.resolved_at)
  const openConflicts = conflicts // prop already filtered to open only

  return (
    <div className="bg-white dark:bg-zinc-900 border border-yellow-300 dark:border-yellow-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 flex items-center gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-yellow-600 dark:text-yellow-400 shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
          {t('git_sync.conflicts_title', { count: openConflicts.length })}
        </p>
      </div>

      <p className="px-4 py-2 text-xs text-gray-500 dark:text-zinc-400">
        {t('git_sync.conflicts_desc')}
      </p>

      {/* Offene Konflikte */}
      {openConflicts.map(c => (
        <ConflictItem key={c.id} conflict={c} onResolved={onResolved} />
      ))}

      {/* Gelöste Konflikte (einklappbar) */}
      {resolvedConflicts.length > 0 && (
        <div className="border-t border-gray-100 dark:border-zinc-800">
          <button
            onClick={() => setShowResolved(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 dark:text-zinc-500 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
          >
            <span>{t('git_sync.conflicts_resolved', { count: resolvedConflicts.length })}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 transition-transform ${showResolved ? 'rotate-180' : ''}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showResolved && (
            <div className="divide-y divide-gray-100 dark:divide-zinc-800">
              {resolvedConflicts.map(c => (
                <div key={c.id} className="px-4 py-2.5 flex items-center gap-3 opacity-60">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    c.resolution === 'git'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
                  }`}>
                    {c.resolution === 'git' ? t('git_sync.resolution_git') : t('git_sync.resolution_local')}
                  </span>
                  <span className="font-mono text-xs text-gray-700 dark:text-zinc-300">{c.item_id}</span>
                  <span className="text-[11px] text-gray-400 dark:text-zinc-500 ml-auto">
                    {c.resolved_by} · {new Date(c.resolved_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
