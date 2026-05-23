// p3portal.org
// PROJ-65: Eine Zeile in der Notification-Liste der Hub-Seite
import { useTranslation } from 'react-i18next'
import { SEVERITY_DOT } from '../severity'

function RelativeTime({ iso }) {
  const { i18n } = useTranslation()
  if (!iso) return null
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60_000)
    const locale = i18n.language === 'en' ? 'en-GB' : 'de-DE'
    if (mins < 1) return <span>{i18n.language === 'en' ? 'just now' : 'gerade eben'}</span>
    if (mins < 60) {
      return <span>{mins} {i18n.language === 'en' ? 'min.' : 'Min.'}</span>
    }
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return <span>{hrs} {i18n.language === 'en' ? 'h' : 'Std.'}</span>
    return (
      <span>
        {new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })}
      </span>
    )
  } catch {
    return null
  }
}

export default function NotificationItemRow({ item, isHighlighted, onClick }) {
  const dotCls = SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors rounded-lg ${
        isHighlighted
          ? 'bg-portal-accent/10 ring-1 ring-portal-accent/30'
          : 'hover:bg-portal-bg3/40'
      } ${!item.read ? 'opacity-100' : 'opacity-55'}`}
    >
      {/* Severity-Punkt */}
      <span className={`w-2 h-2 rounded-full bg-current shrink-0 mt-1.5 ${dotCls}`} aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-sm leading-snug ${!item.read ? 'font-medium text-portal-text' : 'text-portal-text2'}`}>
            {item.title}
          </p>
          <span className="text-xs text-portal-text3 shrink-0">
            <RelativeTime iso={item.created_at} />
          </span>
        </div>
        {item.summary && (
          <p className="text-xs text-portal-text2 mt-0.5 line-clamp-2 leading-relaxed">
            {item.summary}
          </p>
        )}
      </div>

      {!item.read && (
        <span className="w-1.5 h-1.5 rounded-full bg-portal-accent shrink-0 mt-1.5" aria-hidden="true" />
      )}
    </button>
  )
}
