// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchGitSyncConfig } from './api'
import { formatApiError } from '../../api/errors'
import RepoConfigForm from './RepoConfigForm'
import SyncStatusBar from './SyncStatusBar'
import GitSyncLogTable from './GitSyncLogTable'

export default function GitSyncRepoPanel({ repoType, onConflictsChange }) {
  const { t } = useTranslation()
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [logsOpen, setLogsOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const label = repoType === 'ansible'
    ? t('git_sync.repo_ansible')
    : t('git_sync.repo_packer')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const cfg = await fetchGitSyncConfig(repoType)
      setConfig(cfg)
    } catch (err) {
      const msg = formatApiError(err)
      // 404 = noch nicht konfiguriert → leeres config
      if (err?.response?.status === 404) {
        setConfig({
          id: null,
          repo_type: repoType,
          enabled: false,
          repo_url: '',
          branch: 'main',
          subdir: null,
          auth_method: 'https',
          https_username: null,
          has_https_token: false,
          ssh_public_key: null,
          has_webhook_token: false,
          auto_sync_interval: 0,
          updated_at: null,
          updated_by: null,
        })
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [repoType])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <div className="h-4 w-32 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded mb-2" />
        <div className="h-3 w-48 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900 rounded-lg p-4">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <button onClick={load} className="mt-2 btn-secondary text-xs">{t('common.retry')}</button>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{label}</span>
          {config?.enabled && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
              {t('git_sync.status_enabled')}
            </span>
          )}
          {!config?.enabled && config?.repo_url && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
              {t('git_sync.status_disabled')}
            </span>
          )}
        </div>
        <button
          onClick={() => setFormOpen(v => !v)}
          className="btn-table text-xs"
        >
          {config?.repo_url ? t('git_sync.btn_edit') : t('git_sync.btn_configure')}
        </button>
      </div>

      {/* Config-Summary (wenn konfiguriert) */}
      {config?.repo_url && !formOpen && (
        <div className="px-4 py-3 space-y-1 border-b border-gray-100 dark:border-zinc-800">
          <p className="text-xs text-gray-500 dark:text-zinc-400 font-mono truncate" title={config.repo_url}>
            {config.repo_url}
          </p>
          <div className="flex flex-wrap gap-3 text-[11px] text-gray-400 dark:text-zinc-500">
            <span>{t('git_sync.branch_label')}: <span className="font-mono text-gray-700 dark:text-zinc-300">{config.branch}</span></span>
            {config.subdir && (
              <span>{t('git_sync.subdir_label')}: <span className="font-mono text-gray-700 dark:text-zinc-300">{config.subdir}</span></span>
            )}
            <span>{t('git_sync.auth_label')}: <span className="text-gray-700 dark:text-zinc-300">{config.auth_method === 'https' ? 'HTTPS' : 'SSH'}</span></span>
          </div>
        </div>
      )}

      {/* Edit-Formular (aufklappbar) */}
      {formOpen && (
        <div className="border-b border-gray-100 dark:border-zinc-800">
          <RepoConfigForm
            repoType={repoType}
            config={config}
            onSaved={(updated) => { setConfig(updated); setFormOpen(false); load() }}
            onCancel={() => setFormOpen(false)}
            onDeleted={() => { setFormOpen(false); load() }}
          />
        </div>
      )}

      {/* Sync-Status + Jetzt-Button (nur wenn aktiv konfiguriert) */}
      {config?.repo_url && !formOpen && (
        <SyncStatusBar repoType={repoType} onSynced={onConflictsChange} />
      )}

      {/* Sync-Logs (einklappbar) */}
      {config?.repo_url && !formOpen && (
        <div className="border-t border-gray-100 dark:border-zinc-800">
          <button
            onClick={() => setLogsOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors"
          >
            <span>{t('git_sync.logs_toggle')}</span>
            <svg
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
              className={`w-3.5 h-3.5 transition-transform ${logsOpen ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {logsOpen && <GitSyncLogTable repoType={repoType} />}
        </div>
      )}
    </div>
  )
}
