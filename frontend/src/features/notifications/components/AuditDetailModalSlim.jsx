// p3portal.org
// PROJ-65: Slim-Modal für Audit-Log-Einträge im Hub
import { useTranslation } from 'react-i18next'
import { SEVERITY_DOT } from '../severity'

export default function AuditDetailModalSlim({ item, onClose }) {
  const { t } = useTranslation()
  if (!item) return null

  const dotCls = SEVERITY_DOT[item.severity] ?? SEVERITY_DOT.info
  const eventType = item.meta?.event_type ?? ''
  const username = item.meta?.username ?? item.meta?.user ?? ''
  const detail = item.meta?.detail ?? item.summary ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-portal-card rounded-xl shadow-xl w-full max-w-md mx-4 border border-portal-border"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-portal-border">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full bg-current ${dotCls}`} />
            <h2 className="text-sm font-semibold text-portal-text">
              {t('notifications.detail_audit')}
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm font-medium text-portal-text">{item.title}</p>
          {eventType && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-portal-text3">{t('notifications.audit_event_type')}:</span>
              <code className="text-xs bg-portal-bg3/50 px-1.5 py-0.5 rounded font-mono">{eventType}</code>
            </div>
          )}
          {username && (
            <p className="text-xs text-portal-text2">
              {t('notifications.audit_user')}: <span className="font-medium">{username}</span>
            </p>
          )}
          {detail && (
            <p className="text-xs text-portal-text2 leading-relaxed">{detail}</p>
          )}
          <p className="text-xs text-portal-text3">
            {new Date(item.created_at).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  )
}
