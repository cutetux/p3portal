// p3portal.org
import { useState } from 'react'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'

const HASH_ALGORITHMS = [
  { value: '', label: 'None' },
  { value: 'md5', label: 'MD5' },
  { value: 'sha1', label: 'SHA-1' },
  { value: 'sha224', label: 'SHA-224' },
  { value: 'sha256', label: 'SHA-256' },
  { value: 'sha384', label: 'SHA-384' },
  { value: 'sha512', label: 'SHA-512' },
]

function formatBytes(bytes) {
  if (!bytes) return null
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function IsoDownloadModal({ node, onClose, onDownloadStarted, onUseExisting, queryUrl, startDownload }) {
  const [url, setUrl] = useState('')
  const [filename, setFilename] = useState('')
  const [filesize, setFilesize] = useState(null)
  const [contentType, setContentType] = useState(null)
  const [hashAlgo, setHashAlgo] = useState('')
  const [checksum, setChecksum] = useState('')
  const [verifyCerts, setVerifyCerts] = useState(true)
  const [querying, setQuerying] = useState(false)
  const [queryError, setQueryError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)
  const [existsConflict, setExistsConflict] = useState(false)

  const base =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition'

  const handleQueryUrl = async () => {
    if (!url.trim()) return
    setQuerying(true)
    setQueryError(null)
    setExistsConflict(false)
    try {
      const result = await queryUrl(url.trim())
      if (result.filename) setFilename(result.filename)
      if (result.size) setFilesize(result.size)
      if (result.content_type) setContentType(result.content_type)
    } catch (err) {
      setQueryError(err.response?.data?.detail ?? 'URL konnte nicht abgefragt werden.')
    } finally {
      setQuerying(false)
    }
  }

  const handleDownload = async () => {
    if (!url.trim() || !filename.trim()) return
    setDownloading(true)
    setDownloadError(null)
    setExistsConflict(false)
    try {
      const payload = {
        node,
        filename: filename.trim(),
        url: url.trim(),
        verify_certificates: verifyCerts,
      }
      if (hashAlgo) {
        payload.checksum_algorithm = hashAlgo
        payload.checksum = checksum.trim() || null
      }
      const job = await startDownload(payload)
      onDownloadStarted(job, filename.trim())
      onClose()
    } catch (err) {
      if (err.response?.status === 409) {
        setExistsConflict(true)
        setDownloadError(err.response.data?.detail ?? `ISO '${filename}' existiert bereits.`)
      } else {
        setDownloadError(err.response?.data?.detail ?? 'Download konnte nicht gestartet werden.')
      }
    } finally {
      setDownloading(false)
    }
  }

  const handleUseExisting = () => {
    onUseExisting(filename.trim())
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-lg mx-4 shadow-xl rounded-lg"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">ISO herunterladen</h2>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Node: {node}</p>
          </div>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.iso_download" />
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
        </div>

        <div className="p-5 space-y-4">
          {/* URL + Query */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              URL <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleQueryUrl() } }}
                placeholder="https://..."
                className={`${base} flex-1`}
              />
              <button
                type="button"
                onClick={handleQueryUrl}
                disabled={!url.trim() || querying}
                className="shrink-0 px-3 py-2 text-sm border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {querying ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                ) : 'Query URL'}
              </button>
            </div>
            {queryError && <p className="text-xs text-red-500">{queryError}</p>}
          </div>

          {/* Filename */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              Dateiname <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={filename}
              onChange={e => setFilename(e.target.value)}
              placeholder="debian-13.iso"
              className={base}
            />
          </div>

          {/* File info (only shown after query) */}
          {(filesize || contentType) && (
            <div className="flex gap-4 text-xs text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-800 px-3 py-2">
              {filesize && <span>Größe: {formatBytes(filesize)}</span>}
              {contentType && <span>Typ: {contentType}</span>}
            </div>
          )}

          {/* Hash */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
                Hash-Algorithmus
              </label>
              <select
                value={hashAlgo}
                onChange={e => { setHashAlgo(e.target.value); if (!e.target.value) setChecksum('') }}
                className={base}
              >
                {HASH_ALGORITHMS.map(a => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
                Checksum
              </label>
              <input
                type="text"
                value={checksum}
                onChange={e => setChecksum(e.target.value)}
                disabled={!hashAlgo}
                placeholder={hashAlgo ? 'Hash-Wert' : '–'}
                className={`${base} disabled:opacity-40 disabled:cursor-not-allowed`}
              />
            </div>
          </div>

          {/* Verify SSL */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={verifyCerts}
              onChange={e => setVerifyCerts(e.target.checked)}
              className="w-4 h-4 border-gray-300 dark:border-zinc-600 text-orange-600 focus:ring-orange-500"
            />
            <span className="text-sm text-gray-700 dark:text-zinc-300">SSL-Zertifikat verifizieren</span>
          </label>

          {/* ISO already exists */}
          {existsConflict && (
            <div className="bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-800 px-4 py-3 text-sm">
              <p className="font-medium text-yellow-800 dark:text-yellow-300 mb-1">ISO existiert bereits</p>
              <p className="text-xs text-yellow-700 dark:text-yellow-400 mb-3">{downloadError}</p>
              <button
                type="button"
                onClick={handleUseExisting}
                className="text-xs bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1.5 transition-colors"
              >
                Vorhandenes ISO verwenden
              </button>
            </div>
          )}

          {/* General error */}
          {downloadError && !existsConflict && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
              {downloadError}
            </div>
          )}

          {/* Actions */}
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
              disabled={!url.trim() || !filename.trim() || downloading}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {downloading ? (
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
