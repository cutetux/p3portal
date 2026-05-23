// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-62: Plus-only Pool-Auswahl-Feld für PlaybookForm.
// Wird lazy über PlusComponents.PoolSelectorField geladen;
// Core-Komponenten dürfen diese Datei nie direkt importieren.
import { useTranslation } from 'react-i18next'
import { useMyPools } from '../hooks/useMyPools'

/**
 * Einfaches Dropdown „In Pool deployen" für Plus-Nutzer.
 *
 * @param {number|null} value     – aktuell gewählte Pool-ID (null = kein Pool)
 * @param {function}    onChange  – (poolId: number|null) => void
 */
export default function PoolSelectorField({ value, onChange }) {
  const { t } = useTranslation()
  const { pools, loading } = useMyPools()

  if (loading) return null
  if (!pools || pools.length === 0) return null

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
        {t('pools.deploy_pool_label')}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-gray-900 dark:text-zinc-100 px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
      >
        <option value="">{t('pools.deploy_pool_none')}</option>
        {pools.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
        {t('pools.deploy_pool_hint')}
      </p>
    </div>
  )
}
// p3portal.org
