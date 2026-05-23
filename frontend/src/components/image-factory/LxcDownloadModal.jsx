// p3portal.org
import { useState, useEffect } from 'react'
import { getLxcTemplateStorages, downloadLxcTemplate } from '../../api/cluster'

const inputCls =
  'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition rounded'

export default function LxcDownloadModal({ template, portalNodes, onClose, onSuccess }) {
  const [selectedNode, setSelectedNode] = useState(portalNodes[0]?.name ?? '')
  const [storages, setStorages] = useState([])
  const [selectedStorage, setSelectedStorage] = useState('')
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [storagesError, setStoragesError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selectedNode) return
    setStorages([])
    setSelectedStorage('')
    setStoragesError(null)
    setStoragesLoading(true)
    getLxcTemplateStorages(selectedNode)
      .then(list => {
        setStorages(list)
        setSelectedStorage(list[0] ?? '')
      })
      .catch(err => setStoragesError(err.response?.data?.detail ?? 'Storages konnten nicht geladen werden.'))
      .finally(() => setStoragesLoading(false))
  }, [selectedNode])

  async function handleDownload() {
    if (!selectedNode || !selectedStorage) return
    setSubmitting(true)
    setError(null)
    try {
      await downloadLxcTemplate({ node: selectedNode, template: template.template, storage: selectedStorage })
      onSuccess(`Download von ${template.template} auf ${selectedNode}/${selectedStorage} gestartet.`)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Download fehlgeschlagen.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-md mx-4 shadow-xl rounded-lg"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">LXC Template herunterladen</h2>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 font-mono truncate max-w-xs">{template.template}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
            aria-label="Schließen"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Node */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              Ziel-Node <span className="text-red-500">*</span>
            </label>
            {portalNodes.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-zinc-500">Keine Nodes konfiguriert.</p>
            ) : (
              <select
                value={selectedNode}
                onChange={e => setSelectedNode(e.target.value)}
                className={inputCls}
              >
                {portalNodes.map(n => (
                  <option key={n.name} value={n.name}>{n.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Storage */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              Ziel-Storage <span className="text-red-500">*</span>
            </label>
            {storagesLoading ? (
              <div className="h-9 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
            ) : storagesError ? (
              <p className="text-sm text-red-600 dark:text-red-400">{storagesError}</p>
            ) : storages.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-zinc-500">
                {selectedNode ? 'Kein Storage mit vztmpl-Unterstützung gefunden.' : 'Bitte Node wählen.'}
              </p>
            ) : (
              <select
                value={selectedStorage}
                onChange={e => setSelectedStorage(e.target.value)}
                className={inputCls}
              >
                {storages.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!selectedNode || !selectedStorage || submitting}
              className="flex-1 flex items-center justify-center gap-2 btn-primary"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Startet…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download starten
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
