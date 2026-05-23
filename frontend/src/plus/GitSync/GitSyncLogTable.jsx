// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSyncLogs } from './api'

function StatusDot({ status }) {
  const map = {
    success: 'bg-green-500',
    failed: 'bg-red-500',
    running: 'bg-blue-400 animate-pulse',
  }
  return <span className={`inline-block w-2 h-2 rounded-full ${map[status] ?? 'bg-gray-400'}`} />
}

export default function GitSyncLogTable({ repoType }) {
  const { t } = useTranslation()
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    setLoading(true)
    fetchSyncLogs(repoType)
      .then(setLogs)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [repoType])

  if (loading) {
    return <div className="px-4 py-4 h-16 bg-gray-50 dark:bg-zinc-800/40 animate-pulse" />
  }

  if (logs.length === 0) {
    return (
      <p className="px-4 py-4 text-xs text-center text-gray-400 dark:text-zinc-500">
        {t('git_sync.logs_empty')}
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">
            <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400 w-5"></th>
            <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">{t('git_sync.log_col_started')}</th>
            <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">{t('git_sync.log_col_trigger')}</th>
            <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">{t('git_sync.log_col_synced')}</th>
            <th className="text-right px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">{t('git_sync.log_col_conflicts')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {logs.map(log => (
            <>
              <tr
                key={log.id}
                onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 cursor-pointer"
              >
                <td className="px-4 py-2.5">
                  <StatusDot status={log.status} />
                </td>
                <td className="px-3 py-2.5 text-gray-700 dark:text-zinc-300">
                  {new Date(log.started_at).toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-gray-500 dark:text-zinc-400">{log.triggered_by}</td>
                <td className="px-3 py-2.5 text-right text-gray-700 dark:text-zinc-300">{log.items_synced}</td>
                <td className={`px-3 py-2.5 text-right font-medium ${log.items_conflicted > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-400 dark:text-zinc-500'}`}>
                  {log.items_conflicted}
                </td>
              </tr>
              {expanded === log.id && (log.message || log.log_detail) && (
                <tr key={`${log.id}-detail`} className="bg-gray-50 dark:bg-zinc-800/60">
                  <td colSpan={5} className="px-4 py-2">
                    {log.message && (
                      <p className={`text-[11px] mb-1 ${log.status === 'failed' ? 'text-red-500' : 'text-gray-500 dark:text-zinc-400'}`}>
                        {log.message}
                      </p>
                    )}
                    {log.log_detail && (
                      <pre className="text-[10px] font-mono text-gray-500 dark:text-zinc-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                        {log.log_detail}
                      </pre>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}
