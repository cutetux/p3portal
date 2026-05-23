// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSyncLogs, triggerSync } from './api'
import { formatApiError } from '../../api/errors'

function formatDateTime(isoStr) {
  if (!isoStr) return null
  return new Date(isoStr).toLocaleString()
}

function StatusBadge({ status }) {
  const { t } = useTranslation()
  const map = {
    success: { cls: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', label: t('git_sync.status_success') },
    failed: { cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', label: t('git_sync.status_failed') },
    running: { cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400', label: t('git_sync.status_running') },
  }
  const { cls, label } = map[status] ?? { cls: 'bg-gray-100 dark:bg-zinc-800 text-gray-500', label: status }
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>{label}</span>
  )
}

export default function SyncStatusBar({ repoType, onSynced }) {
  const { t } = useTranslation()
  const [lastLog, setLastLog] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [error, setError] = useState('')

  const loadLastLog = useCallback(async () => {
    try {
      const logs = await fetchSyncLogs(repoType)
      setLastLog(logs[0] ?? null)
    } catch {
      // ignore
    }
  }, [repoType])

  useEffect(() => { loadLastLog() }, [loadLastLog])

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    setSyncResult(null)
    try {
      const result = await triggerSync(repoType)
      setSyncResult(result.status)
      // kurz warten, dann Logs neu laden
      setTimeout(() => {
        loadLastLog()
        onSynced?.()
      }, 1500)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      {/* Letzter Sync */}
      <div className="text-xs text-gray-500 dark:text-zinc-400 space-y-0.5">
        {lastLog ? (
          <>
            <div className="flex items-center gap-2">
              <span>{t('git_sync.last_sync_label')}:</span>
              <StatusBadge status={lastLog.status} />
              {lastLog.triggered_by && (
                <span className="text-[10px] text-gray-400 dark:text-zinc-500">
                  via {lastLog.triggered_by}
                </span>
              )}
            </div>
            <div className="text-[11px] text-gray-400 dark:text-zinc-500">
              {formatDateTime(lastLog.started_at)}
              {lastLog.status !== 'running' && lastLog.items_synced != null && (
                <span className="ml-2">{lastLog.items_synced} {t('git_sync.items_synced')}</span>
              )}
              {lastLog.items_conflicted > 0 && (
                <span className="ml-2 text-yellow-600 dark:text-yellow-400">
                  {lastLog.items_conflicted} {t('git_sync.items_conflicted')}
                </span>
              )}
            </div>
            {lastLog.status === 'failed' && lastLog.message && (
              <p className="text-[11px] text-red-500 dark:text-red-400 truncate max-w-xs" title={lastLog.message}>
                {lastLog.message}
              </p>
            )}
          </>
        ) : (
          <span>{t('git_sync.no_sync_yet')}</span>
        )}
        {syncResult === 'queued' && (
          <p className="text-[11px] text-blue-500">{t('git_sync.sync_queued')}</p>
        )}
        {error && <p className="text-[11px] text-red-500">{error}</p>}
      </div>

      {/* Jetzt-synchronisieren-Button */}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="btn-secondary text-xs flex items-center gap-1.5 shrink-0"
      >
        {syncing ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            {t('git_sync.syncing')}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 .49-3" />
            </svg>
            {t('git_sync.sync_now_btn')}
          </>
        )}
      </button>
    </div>
  )
}
