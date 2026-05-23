// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * ThemeRowEditButton – Plus-only Edit-Button pro Theme-Zeile in ThemesTab.
 *
 * Wird über die Plus-Registry (frontend/src/plus/index.js) lazy geladen
 * und nur für nicht-built-in Themes eingebunden, wenn der Konsument
 * (ThemesTab) den Plus-Status bestätigt. Core-Nutzer ziehen diesen
 * Lazy-Chunk nicht nach – sie sehen den Button schlicht nicht (built-in
 * Themes haben ohnehin keine Edit-Aktion, und Custom-Themes existieren
 * in der Core-Edition nicht, weil Upload/Create nur via ThemesAdminActions möglich
 * ist).
 */
import { useTranslation } from 'react-i18next'

export default function ThemeRowEditButton({ theme, onEdit }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={(e) => onEdit(theme, e)}
      className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
    >
      {t('appearance.editor_edit_btn')}
    </button>
  )
}
