// p3portal.org
// PROJ-66: Slide-Over Body §1 — Version, last_check, Status-Badge (AC-SLIDE-3)
import { useTranslation } from 'react-i18next'

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `vor ${diff}s`
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  return `vor ${Math.floor(diff / 86400)} Tagen`
}

const STATUS_BADGE = {
  ready:    'bg-portal-success/15 text-portal-success border-portal-success/30',
  degraded: 'bg-portal-warn/15 text-portal-warn border-portal-warn/30',
  down:     'bg-portal-danger/15 text-portal-danger border-portal-danger/30',
  unknown:  'bg-portal-text/10 text-portal-text/50 border-portal-border',
}

export default function ToolingStatusSection({ toolData }) {
  const { t } = useTranslation()
  const status   = toolData?.status ?? 'unknown'
  const version  = toolData?.version ?? null
  const lastCheck = toolData?.last_check ?? null

  const badgeCls = STATUS_BADGE[status] ?? STATUS_BADGE.unknown

  return (
    <div className="px-4 py-3 border-b border-portal-border">
      <h3 className="text-xs font-semibold text-portal-text/50 uppercase tracking-wide mb-2">
        {t('tooling.section_version')}
      </h3>
      <div className="flex items-center gap-3 flex-wrap">
        {version ? (
          <span className="text-sm font-mono text-portal-text">{version}</span>
        ) : (
          <span className="text-sm text-portal-text/40 italic">{t('tooling.version_unknown')}</span>
        )}
        <span className={`inline-flex items-center text-xs border rounded-full px-2 py-0.5 ${badgeCls}`}>
          {t(`tooling.status_${status}`, { defaultValue: status })}
        </span>
      </div>
      {lastCheck && (
        <p className="text-xs text-portal-text/50 mt-1">
          {t('tooling.last_check_label')}: {timeAgo(lastCheck)}{' '}
          <span className="text-portal-text/30">({new Date(lastCheck).toLocaleString()})</span>
        </p>
      )}
    </div>
  )
}
