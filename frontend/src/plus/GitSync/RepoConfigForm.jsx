// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { saveGitSyncConfig, deleteGitSyncConfig } from './api'
import { formatApiError } from '../../api/errors'
import AuthConfigPanel from './AuthConfigPanel'
import WebhookConfigPanel from './WebhookConfigPanel'

const inputCls = 'w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1'

const INTERVALS = [
  { value: 0, labelKey: 'git_sync.interval_disabled' },
  { value: 5, labelKey: 'git_sync.interval_5' },
  { value: 15, labelKey: 'git_sync.interval_15' },
  { value: 30, labelKey: 'git_sync.interval_30' },
  { value: 60, labelKey: 'git_sync.interval_60' },
]

export default function RepoConfigForm({ repoType, config, onSaved, onCancel, onDeleted }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    enabled: config?.enabled ?? false,
    repo_url: config?.repo_url ?? '',
    branch: config?.branch ?? 'main',
    subdir: config?.subdir ?? '',
    auth_method: config?.auth_method ?? 'https',
    https_username: config?.https_username ?? '',
    https_token: '',
    auto_sync_interval: config?.auto_sync_interval ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        subdir: form.subdir.trim() || null,
        https_token: form.https_token.trim() || null,
        https_username: form.https_username.trim() || null,
      }
      const updated = await saveGitSyncConfig(repoType, payload)
      onSaved(updated)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await deleteGitSyncConfig(repoType)
      onDeleted()
    } catch (err) {
      setError(formatApiError(err))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 space-y-4">
      {/* Aktiviert-Toggle */}
      <div className="flex items-center gap-3">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={form.enabled}
            onChange={e => set('enabled', e.target.checked)}
          />
          <div className="w-9 h-5 bg-gray-200 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-orange-500" />
        </label>
        <span className="text-sm text-gray-700 dark:text-zinc-300">{t('git_sync.enabled_label')}</span>
      </div>

      {/* Repository-URL */}
      <div>
        <label className={labelCls}>{t('git_sync.url_label')} *</label>
        <input
          type="text"
          className={inputCls}
          value={form.repo_url}
          onChange={e => set('repo_url', e.target.value)}
          placeholder="https://github.com/org/repo.git oder git@github.com:org/repo.git"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Branch */}
        <div>
          <label className={labelCls}>{t('git_sync.branch_label')} *</label>
          <input
            type="text"
            className={inputCls}
            value={form.branch}
            onChange={e => set('branch', e.target.value)}
            placeholder="main"
            required
          />
        </div>
        {/* Unterordner */}
        <div>
          <label className={labelCls}>{t('git_sync.subdir_label')}</label>
          <input
            type="text"
            className={inputCls}
            value={form.subdir}
            onChange={e => set('subdir', e.target.value)}
            placeholder={t('git_sync.subdir_placeholder')}
          />
        </div>
      </div>

      {/* Auth-Methode */}
      <div>
        <label className={labelCls}>{t('git_sync.auth_method_label')} *</label>
        <div className="flex gap-4">
          {['https', 'ssh'].map(method => (
            <label key={method} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 dark:text-zinc-300">
              <input
                type="radio"
                name="auth_method"
                value={method}
                checked={form.auth_method === method}
                onChange={() => set('auth_method', method)}
                className="accent-orange-500"
              />
              {method === 'https' ? 'HTTPS (PAT)' : 'SSH (Ed25519)'}
            </label>
          ))}
        </div>
      </div>

      {/* Auth-Details */}
      <AuthConfigPanel
        repoType={repoType}
        authMethod={form.auth_method}
        config={config}
        httpsUsername={form.https_username}
        httpsToken={form.https_token}
        onChangeUsername={v => set('https_username', v)}
        onChangeToken={v => set('https_token', v)}
      />

      {/* Auto-Sync-Interval */}
      <div>
        <label className={labelCls}>{t('git_sync.auto_sync_label')}</label>
        <select
          className={inputCls}
          value={form.auto_sync_interval}
          onChange={e => set('auto_sync_interval', Number(e.target.value))}
        >
          {INTERVALS.map(({ value, labelKey }) => (
            <option key={value} value={value}>{t(labelKey)}</option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-gray-400 dark:text-zinc-500">
          {t('git_sync.auto_sync_hint')}
        </p>
      </div>

      {/* Webhook (nur wenn config.id vorhanden) */}
      {config?.id && (
        <WebhookConfigPanel repoType={repoType} hasToken={config.has_webhook_token} />
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Footer-Buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {config?.id && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={`text-xs px-2.5 py-1.5 rounded transition-colors ${
                confirmDelete
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-500 hover:border-red-400 hover:text-red-500'
              }`}
            >
              {deleting ? '…' : confirmDelete ? t('git_sync.confirm_delete') : t('git_sync.btn_delete')}
            </button>
          )}
          {confirmDelete && !deleting && (
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-zinc-700 text-gray-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary text-xs">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={saving} className="btn-primary text-xs">
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </form>
  )
}
