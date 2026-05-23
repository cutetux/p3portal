// p3portal.org
import { useEffect, useState, useMemo } from 'react'
import { getProxmoxTemplates } from '../../api/cluster'

export default function ProxmoxTemplateSelector({ param, value, onChange, error, nodeValue }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    getProxmoxTemplates()
      .then(data => setTemplates(data))
      .catch(() => setFetchError('Templates konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => {
    if (!nodeValue) return templates
    return templates.filter(t => t.node === nodeValue)
  }, [templates, nodeValue])

  const base =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition'

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {!nodeValue && !loading && (
        <p className="text-xs text-gray-400 dark:text-zinc-500 italic py-2">
          Erst einen Proxmox-Node auswählen.
        </p>
      )}

      {nodeValue && loading && (
        <div className={`${base} text-gray-400 dark:text-zinc-500`}>Lädt Templates…</div>
      )}

      {nodeValue && !loading && fetchError && (
        <div className="space-y-1">
          <input
            type="number"
            value={value ?? ''}
            onChange={e => onChange(param.id, e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Template VM-ID"
            className={`${base} ${error ? 'border-red-500' : ''}`}
          />
          <p className="text-xs text-amber-500">{fetchError} Bitte VM-ID manuell eingeben.</p>
        </div>
      )}

      {nodeValue && !loading && !fetchError && (
        <>
          <select
            value={value ?? ''}
            onChange={e => onChange(param.id, e.target.value === '' ? '' : Number(e.target.value))}
            className={`${base} ${error ? 'border-red-500' : ''}`}
          >
            <option value="">– Template auswählen –</option>
            {visible.map(t => (
              <option key={t.vmid} value={t.vmid}>
                {t.name} (ID {t.vmid})
              </option>
            ))}
          </select>
          {visible.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-zinc-500">
              Keine Templates auf Node &ldquo;{nodeValue}&rdquo; gefunden.
            </p>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
