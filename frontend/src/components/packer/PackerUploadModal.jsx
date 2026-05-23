// p3portal.org
import { useState, useRef } from 'react'
import { uploadPackerDefinition } from '../../api/packer'

export default function PackerUploadModal({ onClose, onUploaded }) {
  const [zipFile, setZipFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!zipFile) {
      setError('Bitte eine ZIP-Datei auswählen.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      await uploadPackerDefinition(zipFile)
      onUploaded()
      onClose()
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Upload fehlgeschlagen.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-lg mx-4 shadow-xl rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Packer-Template hochladen</h2>
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* ZIP drop zone */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              Template-Archiv <span className="text-red-500">*</span>
              <span className="ml-1 text-xs text-gray-400 dark:text-zinc-500">(.zip)</span>
            </label>
            <div
              className="border border-dashed border-gray-300 dark:border-zinc-600 px-4 py-5 flex flex-col items-center gap-2 cursor-pointer hover:border-orange-400 dark:hover:border-orange-500 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 dark:text-zinc-600">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {zipFile ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900 dark:text-zinc-100 truncate max-w-xs">{zipFile.name}</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setZipFile(null) }}
                    className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                    aria-label="Entfernen"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-400 dark:text-zinc-500">ZIP-Datei auswählen oder hierher ziehen</span>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={e => setZipFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Structure hint */}
          <div className="bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 px-4 py-3 space-y-1.5 rounded">
            <p className="text-xs font-medium text-gray-600 dark:text-zinc-400">Erwartete ZIP-Struktur</p>
            <pre className="text-xs text-gray-500 dark:text-zinc-500 leading-relaxed font-mono">{`mein-template/          ← optionaler Wrapper
  mein-template.pkr.hcl  ← Build-Definition (Pflicht)
  meta.yaml              ← Portal-Metadaten (Pflicht)
  description.md         ← Dokumentation (optional)
  http/                  ← Preseed / Kickstart (optional)
  files/                 ← cloud.cfg, Skripte (optional)`}</pre>
            <p className="text-xs text-gray-400 dark:text-zinc-600">
              SSH-Keys (<code className="font-mono">files/sysadm</code>) werden im Volume verwaltet, nicht im ZIP.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
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
              type="submit"
              disabled={uploading}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Hochladen…
                </>
              ) : 'Hochladen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
