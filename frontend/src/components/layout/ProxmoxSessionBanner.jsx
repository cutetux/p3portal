// p3portal.org
import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

export default function ProxmoxSessionBanner() {
  const { auth_type } = useAuth()
  const key = 'p3-proxmox-banner-dismissed'
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(key) === '1')

  if (auth_type !== 'proxmox' || dismissed) return null

  const dismiss = () => {
    sessionStorage.setItem(key, '1')
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 shrink-0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5 shrink-0" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>
        Sie sind als Proxmox-Nutzer angemeldet. Ihre Zugangsdaten werden ausschließlich im Arbeitsspeicher gehalten – nach einem Container-Neustart müssen Sie sich neu anmelden.
      </span>
      <button
        onClick={dismiss}
        className="ml-auto shrink-0 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 transition-colors"
        aria-label="Hinweis schließen"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}
