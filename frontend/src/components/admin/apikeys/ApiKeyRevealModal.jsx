// p3portal.org
import { useState } from 'react'

export default function ApiKeyRevealModal({ apiKey, onClose }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.plaintext_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback für Browser ohne Clipboard-API
      const el = document.createElement('textarea')
      el.value = apiKey.plaintext_key
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">API-Key erstellt</h2>
        </div>

        <div className="p-6 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-sm text-amber-800 dark:text-amber-300">
              <strong>Dieser Key wird nicht erneut angezeigt.</strong> Kopiere ihn jetzt und speichere ihn sicher.
            </p>
          </div>

          {/* Key info */}
          <div>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">
              Key-Name: <span className="text-zinc-800 dark:text-zinc-200">{apiKey.name}</span>
            </p>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-2">
              Scopes: {apiKey.scopes.join(', ')}
            </p>
          </div>

          {/* Key display */}
          <div className="flex items-center gap-2">
            <div className="flex-1 font-mono text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 break-all text-zinc-900 dark:text-zinc-100 select-all">
              {apiKey.plaintext_key}
            </div>
            <button
              onClick={handleCopy}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg transition-colors ${
                copied
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {copied ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Kopiert
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Kopieren
                </>
              )}
            </button>
          </div>

          {/* Usage hint */}
          <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-lg px-4 py-3">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">Verwendung im HTTP-Header:</p>
            <code className="text-xs font-mono text-zinc-800 dark:text-zinc-200 break-all">
              Authorization: Bearer {apiKey.plaintext_key}
            </code>
          </div>
        </div>

        <div className="flex justify-end px-6 pb-6">
          <button
            onClick={onClose}
            className="btn-primary"
          >
            Verstanden, Key gespeichert
          </button>
        </div>
      </div>
    </div>
  )
}
