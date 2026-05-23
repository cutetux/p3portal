// p3portal.org
// PROJ-65: Glocken-Icon im Header – zeigt Anzahl ungelesener Notifications
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotificationSummary } from '../hooks'
import { bellColor } from '../severity'

export default function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: summary } = useNotificationSummary()

  const total = summary?.total ?? 0
  const maxSev = summary?.max_severity ?? null

  const badgeText = total > 99 ? '99+' : total > 0 ? String(total) : null

  const colorCls = bellColor(maxSev)

  const handleClick = () => {
    // Tab mit höchster offener Severity vorauswählen
    const tab = maxSev === 'critical' || maxSev === 'warn'
      ? (summary?.alerts > 0 ? 'alerts' : summary?.announcements > 0 ? 'announcements' : 'events')
      : 'announcements'
    navigate(`/announcements?tab=${tab}`)
  }

  return (
    <button
      onClick={handleClick}
      className={`relative flex items-center justify-center w-8 h-8 rounded-md transition-colors hover:bg-portal-bg3 ${colorCls}`}
      aria-label={t('notifications.bell_label', { count: total })}
      title={t('notifications.bell_tooltip')}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {badgeText && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-portal-danger text-portal-bg text-[10px] font-bold leading-none">
          {badgeText}
        </span>
      )}
    </button>
  )
}
