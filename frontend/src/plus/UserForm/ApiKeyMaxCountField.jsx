// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useTranslation } from 'react-i18next'

const inputCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition'

export default function ApiKeyMaxCountField({ value, onChange }) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
        {t('admin.user_form.api_keys_max_label')}
      </label>
      <input
        type="number"
        min={1}
        max={50}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="5"
        className={inputCls}
      />
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
