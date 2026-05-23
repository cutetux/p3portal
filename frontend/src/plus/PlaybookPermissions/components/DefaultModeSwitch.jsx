// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Toggle für default_playbook_mode (open / restricted) + ConfirmModal.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatApiError } from '../../../api/errors'
import ConfirmModal from '../../../components/common/ConfirmModal'

export default function DefaultModeSwitch({ config, updateConfig }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)

  const currentMode = config?.default_playbook_mode ?? 'open'
  const isRestricted = currentMode === 'restricted'

  const handleToggle = () => {
    const nextMode = isRestricted ? 'open' : 'restricted'
    setError('')

    if (nextMode === 'restricted') {
      // Bestätigung nötig – diese Änderung sperrt sofort alle Playbooks ohne Whitelist
      setConfirm({
        title: t('playbook_permissions.mode_confirm_title'),
        body: t('playbook_permissions.mode_confirm_body_restrict'),
        variant: 'danger',
        confirmLabel: t('playbook_permissions.mode_confirm_ok'),
        onConfirm: () => doUpdate('restricted'),
      })
    } else {
      doUpdate('open')
    }
  }

  const doUpdate = async (mode) => {
    try {
      await updateConfig.mutateAsync(mode)
    } catch (err) {
      setError(formatApiError(err, t('playbook_permissions.mode_update_error')))
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl px-5 py-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {t('playbook_permissions.default_mode_label')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-1">
            {isRestricted
              ? t('playbook_permissions.mode_restricted_desc')
              : t('playbook_permissions.mode_open_desc')}
          </p>
        </div>

        {/* Toggle-Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={isRestricted}
          onClick={handleToggle}
          disabled={updateConfig.isPending}
          className={`relative inline-flex h-6 w-11 items-center rounded-full shrink-0 transition-colors focus:outline-none disabled:opacity-50 ${
            isRestricted ? 'bg-red-500' : 'bg-green-500'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isRestricted ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Status-Badge */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${
          isRestricted
            ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
            : 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isRestricted ? 'bg-red-500' : 'bg-green-500'}`} />
          {isRestricted
            ? t('playbook_permissions.mode_restricted')
            : t('playbook_permissions.mode_open')}
        </span>
        <span className="text-xs text-gray-400 dark:text-zinc-500">
          {isRestricted
            ? t('playbook_permissions.mode_restricted_short')
            : t('playbook_permissions.mode_open_short')}
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {confirm && (
        <ConfirmModal
          {...confirm}
          cancelLabel={t('common.cancel')}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
