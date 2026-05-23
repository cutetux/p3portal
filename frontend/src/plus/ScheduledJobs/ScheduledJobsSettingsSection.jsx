// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import {
  getScheduledJobsSettings,
  setHistoryLimit,
  setSystemSshKey,
  deleteSystemSshKey,
} from '../../api/scheduledJobs'

export default function ScheduledJobsSettingsSection() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)

  // SSH Key state
  const [editingKey, setEditingKey] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [deletingKey, setDeletingKey] = useState(false)
  const [keyMsg, setKeyMsg] = useState('')
  const [keyErr, setKeyErr] = useState('')

  // History limit state
  const [limitDraft, setLimitDraft] = useState('')
  const [savingLimit, setSavingLimit] = useState(false)
  const [limitMsg, setLimitMsg] = useState('')
  const [limitErr, setLimitErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getScheduledJobsSettings()
      setSettings(data)
      setLimitDraft(String(data.history_limit ?? 20))
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaveKey = async () => {
    if (!keyDraft.trim()) { setKeyErr('Bitte einen privaten SSH-Key eingeben.'); return }
    setSavingKey(true); setKeyErr(''); setKeyMsg('')
    try {
      await setSystemSshKey(keyDraft.trim())
      await load()
      setEditingKey(false); setKeyDraft('')
      setKeyMsg('System-SSH-Key gespeichert.')
    } catch {
      setKeyErr('Fehler beim Speichern des Keys.')
    } finally {
      setSavingKey(false)
    }
  }

  const handleDeleteKey = async () => {
    setDeletingKey(true); setKeyErr(''); setKeyMsg('')
    try {
      await deleteSystemSshKey()
      await load()
      setKeyMsg('System-SSH-Key gelöscht.')
    } catch {
      setKeyErr('Fehler beim Löschen.')
    } finally {
      setDeletingKey(false)
    }
  }

  const handleSaveLimit = async () => {
    const n = parseInt(limitDraft, 10)
    if (isNaN(n) || n < 1 || n > 1000) { setLimitErr('Wert zwischen 1 und 1000.'); return }
    setSavingLimit(true); setLimitErr(''); setLimitMsg('')
    try {
      await setHistoryLimit(n)
      await load()
      setLimitMsg('Limit gespeichert.')
    } catch {
      setLimitErr('Fehler beim Speichern.')
    } finally {
      setSavingLimit(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400 dark:text-zinc-500">Lädt…</p>
  }

  const hasKey = !!settings?.has_system_ssh_key

  return (
    <div className="space-y-8">

      {/* System SSH Key */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
              System-SSH-Key
            </h2>
            <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
              Privater SSH-Key für SSH-Jobs mit Key-Quelle &#8222;System&#8220;. Wird Fernet-verschlüsselt gespeichert.
            </p>
          </div>
          {!editingKey && (
            <button
              onClick={() => { setEditingKey(true); setKeyDraft(''); setKeyMsg('') }}
              className="text-sm text-orange-600 hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300 transition-colors"
            >
              {hasKey ? 'Ändern' : 'Hinterlegen'}
            </button>
          )}
        </div>

        {!editingKey && (
          <div className="flex items-center gap-3">
            {hasKey ? (
              <>
                <code className="flex-1 text-xs font-mono bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-3 py-2 text-gray-700 dark:text-zinc-300 truncate rounded">
                  ••••••• (gesetzt)
                </code>
                <button
                  onClick={handleDeleteKey}
                  disabled={deletingKey}
                  className="text-sm text-red-500 hover:text-red-600 dark:text-red-400 disabled:opacity-50 transition-colors shrink-0"
                >
                  {deletingKey ? 'Löscht…' : 'Entfernen'}
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-400 dark:text-zinc-500 italic">Kein System-SSH-Key hinterlegt.</p>
            )}
          </div>
        )}

        {editingKey && (
          <div className="space-y-3">
            <textarea
              rows={6}
              value={keyDraft}
              onChange={e => setKeyDraft(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
              className="w-full border px-3 py-2 text-xs font-mono bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 rounded resize-y"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveKey}
                disabled={savingKey}
                className="btn-primary"
              >
                {savingKey ? 'Speichert…' : 'Speichern'}
              </button>
              <button
                onClick={() => { setEditingKey(false); setKeyDraft(''); setKeyErr('') }}
                className="text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 px-4 py-2 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {keyErr && <p className="mt-2 text-xs text-red-500">{keyErr}</p>}
        {keyMsg && <p className="mt-2 text-xs text-green-600 dark:text-green-400">{keyMsg}</p>}
        <span className="rq hidden" aria-hidden="true" />
      </div>

      {/* History Limit */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
          Run-History-Limit
        </h2>
        <p className="text-sm text-gray-500 dark:text-zinc-500 mb-4">
          Maximale Anzahl gespeicherter Runs pro Job. &Auml;ltere Eintr&auml;ge werden automatisch gel&ouml;scht.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={1000}
            value={limitDraft}
            onChange={e => setLimitDraft(e.target.value)}
            className="w-32 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
          <button
            onClick={handleSaveLimit}
            disabled={savingLimit}
            className="btn-primary"
          >
            {savingLimit ? 'Speichert…' : 'Speichern'}
          </button>
        </div>
        {limitErr && <p className="mt-2 text-xs text-red-500">{limitErr}</p>}
        {limitMsg && <p className="mt-2 text-xs text-green-600 dark:text-green-400">{limitMsg}</p>}
        <span className="rq hidden" aria-hidden="true" />
      </div>

    </div>
  )
}
