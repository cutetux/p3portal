// p3portal.org
import { useState } from 'react'
import { useAnnouncements } from '../../hooks/useAnnouncements'

const VARIANT = {
  info: {
    bg: 'border-portal-info/40 dark:bg-portal-info/10 bg-portal-info/5',
    text: 'text-portal-info',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  warn: {
    bg: 'border-portal-warn/40 dark:bg-portal-warn/10 bg-portal-warn/5',
    text: 'text-portal-warn',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  critical: {
    bg: 'border-portal-danger/40 dark:bg-portal-danger/10 bg-portal-danger/5',
    text: 'text-portal-danger',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  success: {
    bg: 'border-portal-success/40 dark:bg-portal-success/10 bg-portal-success/5',
    text: 'text-portal-success',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
}

function AnnouncementItem({ announcement }) {
  const sessionKey = `p3-announcement-dismissed-${announcement.id}`
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(sessionKey) === 'true'
  )

  if (dismissed) return null

  const variant = VARIANT[announcement.severity] ?? VARIANT.info

  const dismiss = () => {
    sessionStorage.setItem(sessionKey, 'true')
    setDismissed(true)
  }

  return (
    <div className={`flex items-start gap-3 border rounded-lg px-4 py-2.5 text-sm ${variant.bg}`}>
      <span className={variant.text}>{variant.icon}</span>
      <span className={`flex-1 break-words ${variant.text}`}>{announcement.message}</span>
      <button
        onClick={dismiss}
        className={`ml-auto shrink-0 transition-colors hover:opacity-70 ${variant.text}`}
        aria-label="Ausblenden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  )
}

export default function AnnouncementsBanner() {
  const { announcements, loading } = useAnnouncements()

  if (loading || !announcements.length) return null

  return (
    <div className="space-y-2">
      {announcements.map((a) => (
        <AnnouncementItem key={a.id} announcement={a} />
      ))}
    </div>
  )
}
