// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState } from 'react'
import { formatApiError } from '../../api/errors'
import AlertPresetFormModal from './AlertPresetFormModal'

export default function AlertPresetList({ presets, onUpdate, onDelete, emptyText = 'Keine Presets.' }) {
  const [editPreset, setEditPreset] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const handleSave = async (payload) => {
    setSaving(true)
    setSaveError(null)
    try {
      await onUpdate(editPreset.id, payload)
      setEditPreset(null)
    } catch (err) {
      setSaveError(formatApiError(err, 'Speichern fehlgeschlagen.'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (preset) => {
    if (!confirm(`Preset "${preset.name}" und alle zugewiesenen VMs löschen?`)) return
    try {
      await onDelete(preset.id)
    } catch {
      // ignore
    }
  }

  if (presets.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-zinc-500 py-4 text-center">{emptyText}</p>
  }

  return (
    <>
      <div className="space-y-3">
        {presets.map(p => (
          <div key={p.id} className="border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">{p.name}</p>
                {p.description && (
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{p.description}</p>
                )}
                <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-zinc-400">
                  <span>{p.rule_count} {p.rule_count === 1 ? 'Regel' : 'Regeln'}</span>
                  <span>{p.vm_count} {p.vm_count === 1 ? 'VM' : 'VMs'}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => { setEditPreset(p); setSaveError(null) }}
                  className="text-xs text-orange-600 dark:text-orange-400 hover:underline transition-colors"
                >
                  Bearbeiten
                </button>
                <button
                  onClick={() => handleDelete(p)}
                  className="text-xs text-red-500 dark:text-red-400 hover:underline transition-colors"
                >
                  Löschen
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {editPreset && (
        <AlertPresetFormModal
          preset={editPreset}
          onSave={handleSave}
          onClose={() => setEditPreset(null)}
          loading={saving}
          error={saveError}
        />
      )}
    </>
  )
}
