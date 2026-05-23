// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * NodeSetDefaultButton – Plus-only "Standard setzen" Aktion pro Node-Zeile
 * in der Admin-NodeTable.
 *
 * Wird über die Plus-Registry (frontend/src/plus/index.js) lazy geladen
 * und nur eingebunden, wenn der Konsument (NodeTable) den Plus-Status
 * bestätigt UND der Node nicht bereits Default ist. Core-Nutzer ziehen
 * diesen Lazy-Chunk nie nach – sie sehen die Aktion schlicht nicht
 * (Default-Wechsel ist Plus-Feature, das Default-Badge bleibt sichtbar).
 *
 * Pattern analog zu plus/Themes/ThemeRowEditButton (S13) und
 * plus/Themes/ThemesAdminActions (S11).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setDefaultNode } from '../../api/nodes'

export default function NodeSetDefaultButton({ node, onRefresh, onError }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    setBusy(true)
    try {
      await setDefaultNode(node.id)
      await onRefresh?.()
    } catch (ex) {
      onError?.(ex.response?.data?.detail ?? t('admin.nodes.err_set_default'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      className="text-xs text-gray-400 dark:text-zinc-500 hover:text-orange-500 transition-colors disabled:opacity-50"
    >
      {t('admin.nodes.set_default')}
    </button>
  )
}
