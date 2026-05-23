// p3portal.org
// PROJ-66: Slide-Over Body §3 — Audit-Historie (letzte 20 Transitions) (AC-SLIDE-3)
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToolingAuditHistory } from '../hooks'

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `vor ${diff}s`
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  return `vor ${Math.floor(diff / 86400)} Tagen`
}

const STATUS_COLOR = {
  ready:    'text-portal-success',
  degraded: 'text-portal-warn',
  down:     'text-portal-danger',
  unknown:  'text-portal-text/40',
}

function TransitionRow({ item }) {
  const [expanded, setExpanded] = useState(false)
  const from    = item.from_status    ?? '?'
  const to      = item.to_status      ?? '?'
  const excerpt = item.stderr_excerpt ?? null

  return (
    <li className="flex flex-col gap-0.5 py-1.5 border-b border-portal-border last:border-0">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-portal-text/40 shrink-0 tabular-nums">{timeAgo(item.created_at)}</span>
        <span className={STATUS_COLOR[from] ?? 'text-portal-text/60'}>{from}</span>
        <span className="text-portal-text/30">→</span>
        <span className={STATUS_COLOR[to] ?? 'text-portal-text/60'}>{to}</span>
        {item.version && (
          <span className="text-portal-text/40 font-mono ml-auto">{item.version}</span>
        )}
      </div>
      {excerpt && (
        <div className="text-xs">
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            className="text-portal-text/40 hover:text-portal-text/70 underline"
          >
            {expanded ? '▲ weniger' : '▼ Details'}
          </button>
          {expanded && (
            <pre className="mt-1 text-portal-danger bg-portal-bg-alt rounded p-1 text-[10px] whitespace-pre-wrap break-all font-mono max-h-20 overflow-y-auto">
              {excerpt}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

export default function ToolingHistorySection({ tool }) {
  const { t } = useTranslation()
  const { data, isLoading } = useToolingAuditHistory(tool)
  const items = data?.items ?? []

  return (
    <div className="px-4 py-3 border-b border-portal-border">
      <h3 className="text-xs font-semibold text-portal-text/50 uppercase tracking-wide mb-2">
        {t('tooling.section_history')}
      </h3>
      {isLoading ? (
        <p className="text-xs text-portal-text/40">{t('common.loading')}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-portal-text/40 italic">{t('tooling.history_empty')}</p>
      ) : (
        <ul className="divide-y divide-portal-border">
          {items.map(item => (
            <TransitionRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </div>
  )
}
