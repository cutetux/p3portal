// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { regenerateWebhookToken } from './api'
import { formatApiError } from '../../api/errors'

export default function WebhookConfigPanel({ repoType, hasToken }) {
  const { t } = useTranslation()
  const [webhookUrl, setWebhookUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleRegen = async () => {
    if (!confirmRegen && hasToken && webhookUrl) { setConfirmRegen(true); return }
    setLoading(true)
    setError('')
    try {
      const data = await regenerateWebhookToken(repoType)
      const origin = window.location.origin
      setWebhookUrl(`${origin}${data.webhook_url_template}`)
      setConfirmRegen(false)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    if (!webhookUrl) return
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 rounded p-3 space-y-2">
      <p className="text-xs font-medium text-gray-700 dark:text-zinc-300">
        {t('git_sync.webhook_title')}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-zinc-400">
        {t('git_sync.webhook_desc')}
      </p>

      {webhookUrl ? (
        <div className="space-y-2">
          <div className="relative">
            <input
              readOnly
              type="text"
              className="w-full text-xs font-mono border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-300 px-3 py-2 rounded pr-16 focus:outline-none"
              value={webhookUrl}
              onClick={e => e.target.select()}
            />
            <button
              type="button"
              onClick={handleCopy}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-600 transition-colors"
            >
              {copied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
          <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
            {t('git_sync.webhook_save_hint')}
          </p>
          <div className="flex items-center gap-2">
            {confirmRegen && (
              <button type="button" onClick={() => setConfirmRegen(false)} className="btn-secondary text-xs">
                {t('common.cancel')}
              </button>
            )}
            <button
              type="button"
              onClick={handleRegen}
              disabled={loading}
              className={`text-xs px-2.5 py-1.5 rounded transition-colors ${
                confirmRegen
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'border border-gray-200 dark:border-zinc-700 text-gray-400 hover:border-orange-400 hover:text-orange-500 dark:text-zinc-500'
              }`}
            >
              {loading ? '…' : confirmRegen ? t('git_sync.webhook_regen_confirm') : t('git_sync.webhook_regen_btn')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleRegen}
          disabled={loading}
          className="btn-secondary text-xs"
        >
          {loading ? t('common.loading') : hasToken ? t('git_sync.webhook_show_btn') : t('git_sync.webhook_generate_btn')}
        </button>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
