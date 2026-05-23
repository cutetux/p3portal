// p3portal.org
// PROJ-57: (i)-Icon für Modal-Header (rechts neben Schließen-Button).
// Verwendung: <ModalHelpButton helpKey="modal.user_form" />
import { useHelpSlideOver } from './HelpSlideOverContext'

export default function ModalHelpButton({ helpKey, className = '' }) {
  const { open } = useHelpSlideOver()
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); open(helpKey) }}
      aria-label="Formular-Hilfe anzeigen"
      title="Hilfe"
      className={`inline-flex items-center justify-center text-gray-300 dark:text-zinc-600 hover:text-gray-500 dark:hover:text-zinc-400 transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${className}`}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-[13px] h-[13px]">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" />
        <circle cx="12" cy="17" r="0.5" fill="currentColor" />
      </svg>
    </button>
  )
}
