// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
/**
 * LanguagesAdminActions – Plus-only Aktions-Leiste für die Sprach-
 * Verwaltung (Upload eigener .yml/.yaml-Sprachdateien).
 *
 * Wird über die Plus-Registry (frontend/src/plus/index.js) lazy geladen
 * und nur eingebunden, wenn der Konsument (LanguagesTab) den Plus-Status
 * bestätigt. Core-Nutzer sehen stattdessen einen kleinen Lock-Hinweis,
 * der inline in LanguagesTab gerendert wird – sie ziehen diesen
 * Lazy-Chunk nicht nach.
 *
 * Pattern identisch zu plus/Themes/ThemesAdminActions (S11): Upload-
 * Button öffnet Datei-Dialog, ruft uploadLanguage() und triggert
 * onReload + onMessage im Parent.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { uploadLanguage } from '../../api/translations'

export default function LanguagesAdminActions({ onReload, onMessage }) {
  const { t } = useTranslation()
  const fileRef = useRef()
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadLanguage(file)
      await onReload?.()
      onMessage?.(t('appearance.lang_saved'), true)
    } catch {
      onMessage?.(t('common.error'), false)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".yml,.yaml" className="hidden" onChange={handleUpload} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="btn-secondary text-xs px-3 py-1.5"
      >
        {uploading ? t('appearance.uploading') : t('appearance.upload_lang')}
      </button>
    </>
  )
}
