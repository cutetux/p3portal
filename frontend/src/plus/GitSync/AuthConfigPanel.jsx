// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSshKey, regenerateSshKey } from './api'
import { formatApiError } from '../../api/errors'

const inputCls = 'w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500'
const labelCls = 'block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1'

export default function AuthConfigPanel({
  repoType,
  authMethod,
  config,
  httpsUsername,
  httpsToken,
  onChangeUsername,
  onChangeToken,
}) {
  const { t } = useTranslation()
  const [sshKey, setSshKey] = useState(config?.ssh_public_key ?? null)
  const [sshLoading, setSshLoading] = useState(false)
  const [sshError, setSshError] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)

  const handleCopy = () => {
    if (!sshKey) return
    navigator.clipboard.writeText(sshKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleLoadSshKey = async () => {
    setSshLoading(true)
    setSshError('')
    try {
      const data = await fetchSshKey(repoType)
      setSshKey(data.public_key)
    } catch (err) {
      if (err?.response?.status === 404) {
        setSshKey(null)
      } else {
        setSshError(formatApiError(err))
      }
    } finally {
      setSshLoading(false)
    }
  }

  const handleRegenerate = async () => {
    if (!confirmRegen) { setConfirmRegen(true); return }
    setRegenLoading(true)
    setSshError('')
    try {
      const data = await regenerateSshKey(repoType)
      setSshKey(data.public_key)
      setConfirmRegen(false)
    } catch (err) {
      setSshError(formatApiError(err))
    } finally {
      setRegenLoading(false)
    }
  }

  if (authMethod === 'https') {
    return (
      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t('git_sync.https_username_label')}</label>
          <input
            type="text"
            className={inputCls}
            value={httpsUsername}
            onChange={e => onChangeUsername(e.target.value)}
            placeholder={t('git_sync.https_username_placeholder')}
            autoComplete="off"
          />
        </div>
        <div>
          <label className={labelCls}>
            {t('git_sync.https_token_label')}
            {config?.has_https_token && (
              <span className="ml-2 text-[10px] text-green-600 dark:text-green-400 font-normal">
                {t('git_sync.token_set')}
              </span>
            )}
          </label>
          <input
            type="password"
            className={inputCls}
            value={httpsToken}
            onChange={e => onChangeToken(e.target.value)}
            placeholder={config?.has_https_token ? t('git_sync.token_change_placeholder') : t('git_sync.token_enter_placeholder')}
            autoComplete="new-password"
          />
        </div>
      </div>
    )
  }

  // SSH
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-zinc-400">
        {t('git_sync.ssh_hint')}
      </p>

      {!sshKey && !config?.ssh_public_key ? (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-3 space-y-2">
          <p className="text-xs text-yellow-700 dark:text-yellow-400">
            {t('git_sync.ssh_no_key')}
          </p>
          <p className="text-xs text-yellow-600 dark:text-yellow-500">
            {t('git_sync.ssh_generate_hint')}
          </p>
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenLoading}
            className="btn-secondary text-xs"
          >
            {regenLoading ? t('git_sync.ssh_generating') : t('git_sync.ssh_generate_btn')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className={labelCls}>{t('git_sync.ssh_public_key_label')}</label>
          <div className="relative">
            <textarea
              readOnly
              rows={3}
              className="w-full text-xs font-mono border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-zinc-300 px-3 py-2 rounded resize-none focus:outline-none"
              value={sshKey ?? config?.ssh_public_key ?? ''}
              onClick={e => e.target.select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-600 transition-colors"
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-zinc-500">
            {t('git_sync.ssh_deploy_key_hint')}
          </p>
          <div className="flex items-center gap-2">
            {confirmRegen && (
              <button type="button" onClick={() => setConfirmRegen(false)} className="btn-secondary text-xs">
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={regenLoading}
              className={`text-xs px-2.5 py-1.5 rounded transition-colors ${
                confirmRegen
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'border border-gray-200 dark:border-zinc-700 text-gray-400 hover:border-orange-400 hover:text-orange-500 dark:text-zinc-500'
              }`}
            >
              {regenLoading ? '…' : confirmRegen ? t('git_sync.ssh_regen_confirm') : t('git_sync.ssh_regen_btn')}
            </button>
          </div>
          {sshError && <p className="text-xs text-red-500">{sshError}</p>}
        </div>
      )}
      {!sshKey && config?.ssh_public_key && !sshLoading && (
        <button type="button" onClick={handleLoadSshKey} className="btn-secondary text-xs">
          {t('git_sync.ssh_show_key')}
        </button>
      )}
      {sshLoading && <p className="text-xs text-gray-400">{t('common.loading')}</p>}
    </div>
  )
}
