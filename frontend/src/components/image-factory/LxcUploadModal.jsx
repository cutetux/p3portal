// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { getLxcTemplateStorages, uploadLxcTemplate } from '../../api/cluster'

const MAX_BYTES = 4 * 1024 * 1024 * 1024
const VALID_EXT = /\.(tar\.gz|tar\.zst)$/i
const VALID_NAME = /^[a-zA-Z0-9._-]+\.(tar\.gz|tar\.zst)$/i

const inputCls =
  'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition rounded'

export default function LxcUploadModal({ portalNodes, onClose, onSuccess }) {
  const [selectedNode, setSelectedNode] = useState(portalNodes[0]?.name ?? '')
  const [storages, setStorages] = useState([])
  const [selectedStorage, setSelectedStorage] = useState('')
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [file, setFile] = useState(null)
  const [fileError, setFileError] = useState(null)
  const [progress, setProgress] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!selectedNode) return
    setStorages([])
    setSelectedStorage('')
    setStoragesLoading(true)
    getLxcTemplateStorages(selectedNode)
      .then(list => {
        setStorages(list)
        setSelectedStorage(list[0] ?? '')
      })
      .catch(() => setStorages([]))
      .finally(() => setStoragesLoading(false))
  }, [selectedNode])

  function handleFileChange(e) {
    const f = e.target.files?.[0]
    setFileError(null)
    setFile(null)
    if (!f) return
    if (!VALID_EXT.test(f.name)) {
      setFileError('Nur .tar.gz und .tar.zst Dateien erlaubt.')
      return
    }
    if (!VALID_NAME.test(f.name)) {
      setFileError('Dateiname darf nur [a-zA-Z0-9._-] und muss auf .tar.gz / .tar.zst enden.')
      return
    }
    if (f.size > MAX_BYTES) {
      setFileError('Datei überschreitet Maximum von 4 GB.')
      return
    }
    setFile(f)
  }

  async function handleUpload() {
    if (!selectedNode || !selectedStorage || !file) return
    setUploading(true)
    setError(null)
    setProgress(0)
    try {
      await uploadLxcTemplate({
        node: selectedNode,
        storage: selectedStorage,
        file,
        onUploadProgress: evt => {
          if (evt.total) setProgress(Math.round((evt.loaded / evt.total) * 100))
        },
      })
      onSuccess(`${file.name} erfolgreich nach ${selectedNode}/${selectedStorage} hochgeladen.`)
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Upload fehlgeschlagen.')
      setProgress(null)
    } finally {
      setUploading(false)
    }
  }

  const canSubmit = selectedNode && selectedStorage && file && !fileError && !uploading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-md mx-4 shadow-xl rounded-lg"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">LXC Template hochladen</h2>
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

          {/* File */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              Template-Datei <span className="text-red-500">*</span>
              <span className="ml-1 text-xs font-normal text-gray-400 dark:text-zinc-500">(.tar.gz / .tar.zst)</span>
            </label>
            <div
              className="border-2 border-dashed border-gray-300 dark:border-zinc-600 rounded px-4 py-5 text-center cursor-pointer hover:border-orange-400 dark:hover:border-orange-500 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? (
                <p className="text-sm text-gray-700 dark:text-zinc-300 font-mono truncate">{file.name}</p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-zinc-500">
                  Datei hier ablegen oder <span className="text-orange-500">auswählen</span>
                </p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".tar.gz,.tar.zst"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
            {fileError && <p className="text-xs text-red-500 dark:text-red-400">{fileError}</p>}
          </div>

          {/* Progress */}
          {progress !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-400">
                <span>Upload…</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-zinc-700 rounded-full h-1.5">
                <div
                  className="bg-orange-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="btn-secondary flex-1"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!canSubmit}
              className="flex-1 flex items-center justify-center gap-2 btn-primary"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Hochladen…
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Hochladen
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
