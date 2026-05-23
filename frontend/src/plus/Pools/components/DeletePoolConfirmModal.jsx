// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Bestätigungs-Modal für das Löschen eines Pools mit Vorschau (AC-6).
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { poolsApi } from '../api'
import { formatApiError } from '../../../api/errors'

export default function DeletePoolConfirmModal({ pool, onSuccess, onClose }) {
  const { t }           = useTranslation()
  const [preview, setPreview] = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    poolsApi.getDeletePreview(pool.id).then(setPreview).catch(() => {})
  }, [pool.id])

  const handleDelete = async () => {
    setBusy(true)
    setError('')
    try {
      await poolsApi.remove(pool.id)
      onSuccess()
    } catch (err) {
      setError(formatApiError(err, t('pools.delete_error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('pools.delete_title')}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-zinc-300">
            {t('pools.delete_confirm', { name: pool.name })}
          </p>

          {preview && (preview.member_count > 0 || preview.assignment_count > 0) && (
            <div className="flex flex-col gap-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{t('pools.delete_warning')}</span>
              </div>
              {preview.member_count > 0 && (
                <span className="ml-5">• {t('pools.delete_members_hint', { count: preview.member_count })}</span>
              )}
              {preview.assignment_count > 0 && (
                <span className="ml-5">• {t('pools.delete_assignments_hint', { count: preview.assignment_count })}</span>
              )}
              <p className="ml-5 text-amber-500 dark:text-amber-500 font-normal mt-0.5">
                {t('pools.delete_vms_preserved')}
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="btn-danger"
          >
            {busy ? '…' : t('common.delete')}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
