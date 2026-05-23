// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import {
  fetchAssignments,
  createAssignment,
  deleteAssignment,
  fetchPresets,
} from '../../../api/rbac'

const inputCls =
  'bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition'

const TYPE_LABELS = { vm: 'VM', lxc: 'LXC' }

export default function AssignmentSection({ userId }) {
  const [assignments, setAssignments] = useState([])
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ resource_type: 'vm', resource_id: '', preset_id: '' })
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const p = await fetchPresets()
      setPresets(p)
    } catch {
      // presets are critical for the add form – show error if they fail
      setError('Presets konnten nicht geladen werden.')
    }
    try {
      const a = await fetchAssignments(userId)
      setAssignments(a)
    } catch {
      setError('Zuweisungen konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    setSaveError('')
    if (!form.resource_id || !form.preset_id) {
      setSaveError('Alle Felder ausfüllen.')
      return
    }
    setSaving(true)
    try {
      await createAssignment(userId, {
        resource_type: form.resource_type,
        resource_id: parseInt(form.resource_id, 10),
        preset_id: parseInt(form.preset_id, 10),
      })
      setForm({ resource_type: 'vm', resource_id: '', preset_id: '' })
      setAdding(false)
      load()
    } catch (err) {
      const s = err.response?.status
      const d = err.response?.data?.detail
      if (s === 409) setSaveError('Diese Zuweisung existiert bereits.')
      else setSaveError(d ?? 'Fehler beim Hinzufügen.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (assignment) => {
    try {
      await deleteAssignment(userId, assignment.id)
      load()
    } catch {
      setError('Fehler beim Entfernen der Zuweisung.')
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-zinc-700">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            Ressourcen-Zuweisungen
          </h3>
          <p className="text-xs text-gray-400 dark:text-zinc-600 mt-0.5">
            Welche VMs/LXCs dieser Nutzer sehen und verwalten darf.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => { setSaveError(''); setAdding(true) }}
            className="btn-primary"
          >
            + Hinzufügen
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-3">{error}</p>
      )}

      {/* Add form */}
      {adding && (
        <div className="mb-4 p-3 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 space-y-2 rounded-lg">
          <p className="text-xs font-medium text-gray-700 dark:text-zinc-300 mb-2">Neue Zuweisung</p>
          <div className="flex gap-2 flex-wrap">
            <select
              value={form.resource_type}
              onChange={(e) => setForm((f) => ({ ...f, resource_type: e.target.value }))}
              className={`${inputCls} w-24`}
            >
              <option value="vm">VM</option>
              <option value="lxc">LXC</option>
            </select>
            <input
              type="number"
              min="1"
              value={form.resource_id}
              onChange={(e) => setForm((f) => ({ ...f, resource_id: e.target.value }))}
              placeholder="VM-ID (z.B. 100)"
              className={`${inputCls} w-44`}
            />
            <select
              value={form.preset_id}
              onChange={(e) => setForm((f) => ({ ...f, preset_id: e.target.value }))}
              className={`${inputCls} flex-1 min-w-32`}
            >
              <option value="">Preset wählen…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {saveError && (
            <p className="text-xs text-red-400">{saveError}</p>
          )}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleAdd}
              className="btn-primary"
            >
              {saving ? 'Speichern…' : 'Speichern'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setSaveError('') }}
              className="btn-secondary"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Assignment list */}
      {loading ? (
        <p className="text-xs text-gray-400 dark:text-zinc-600 py-3">Lade…</p>
      ) : assignments.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-3">
          Keine Zuweisungen – Nutzer sieht alle Ressourcen (bisheriges Verhalten).
        </p>
      ) : (
        <div className="border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-500 uppercase tracking-wider bg-gray-50 dark:bg-zinc-900">
                <th className="px-3 py-2 text-left">Typ</th>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Preset</th>
                <th className="px-3 py-2 text-left">Aktionen</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
              {assignments.map((a) => (
                <tr key={a.id} className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800">
                  <td className="px-3 py-2">
                    <span className="bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5">
                      {TYPE_LABELS[a.resource_type] ?? a.resource_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-gray-700 dark:text-zinc-300 font-medium">
                    {a.resource_id}
                  </td>
                  <td className="px-3 py-2 text-gray-700 dark:text-zinc-300">{a.preset_name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-zinc-400">
                    {a.permissions.join(', ')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(a)}
                      className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                      title="Zuweisung entfernen"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
