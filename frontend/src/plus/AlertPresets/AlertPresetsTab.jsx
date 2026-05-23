// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { listPresets, createPreset, updatePreset, deletePreset } from '../../api/alerts'
import { formatApiError } from '../../api/errors'
import AlertPresetList from './AlertPresetList'
import AlertPresetFormModal from './AlertPresetFormModal'
import PlusBadge from '../../components/common/PlusBadge'

export default function AlertPresetsTab() {
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await listPresets()
      setPresets(data)
    } catch (err) {
      const status = err?.response?.status
      if (status === 403) setLoadError('Alert-Presets erfordern eine Plus-Lizenz.')
      else setLoadError('Presets konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (payload) => {
    setSaving(true)
    setSaveError(null)
    try {
      await createPreset(payload)
      setShowNew(false)
      await load()
    } catch (err) {
      setSaveError(formatApiError(err, 'Preset konnte nicht erstellt werden.'))
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (presetId, payload) => {
    await updatePreset(presetId, payload)
    await load()
  }

  const handleDelete = async (presetId) => {
    await deletePreset(presetId)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100 flex items-center">
            Alert-Presets <PlusBadge />
          </h3>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
            Benannte Regelsammlungen, die VMs zugewiesen werden können.
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setSaveError(null) }}
          className="btn-primary"
        >
          + Neues Preset
        </button>
      </div>

      {loadError && (
        <div className="border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400 rounded">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-gray-100 dark:bg-zinc-800 rounded-lg" />)}
        </div>
      ) : (
        <AlertPresetList
          presets={presets}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          emptyText="Keine Presets konfiguriert."
        />
      )}

      {showNew && (
        <AlertPresetFormModal
          preset={null}
          onSave={handleCreate}
          onClose={() => setShowNew(false)}
          loading={saving}
          error={saveError}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
