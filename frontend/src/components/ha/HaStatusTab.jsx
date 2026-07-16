// p3portal.org
// PROJ-103: HA-Status-Tab – Quorum, CRM/LRM-Manager, Node- und Ressourcen-Zustände
// (read-only, viewer+). Nie 500: Availability-Flags statt Fehler; sauberer
// Leerzustand wenn HA (noch) nicht konfiguriert ist (AC-STATUS-3).
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getHaStatus } from '../../api/ha'
import { AvailabilityBanner, isUnavailable, HaStateBadge, thCls } from './haHelpers'

export default function HaStatusTab({ portalNodeId = null } = {}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getHaStatus(portalNodeId)
      .then((d) => setStatus(d))
      .catch(() => setStatus({ cluster_unreachable: true }))
      .finally(() => setLoading(false))
  }, [portalNodeId])

  useEffect(() => { load() }, [load])

  if (loading && status == null) {
    return <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-6">{t('ha.loading')}</p>
  }

  const unavailable = isUnavailable(status)
  const resources = status?.resources ?? []
  const nodes = status?.nodes ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button onClick={load} disabled={loading} className="btn-table">{t('ha.refresh')}</button>
      </div>

      <AvailabilityBanner resp={status} />

      {!unavailable && (
        <>
          {/* Quorum + Manager */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">{t('ha.quorum')}</p>
              <p className={`text-sm font-semibold mt-1 ${status?.quorate ? 'text-portal-success' : status?.quorate === false ? 'text-portal-danger' : 'text-gray-500'}`}>
                {status?.quorate == null ? t('ha.state_unknown') : status?.quorate ? t('ha.quorum_ok') : t('ha.quorum_lost')}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">{t('ha.manager')}</p>
              <p className="text-sm font-semibold mt-1 text-gray-900 dark:text-zinc-100">
                {status?.manager_node || t('ha.no_manager')}
                {status?.manager_status && <span className="ml-1 text-xs font-normal text-gray-400 dark:text-zinc-500">({status.manager_status})</span>}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">{t('ha.resource_count')}</p>
              <p className="text-sm font-semibold mt-1 text-gray-900 dark:text-zinc-100">{resources.length}</p>
            </div>
          </div>

          {/* Nodes (CRM/LRM) */}
          {nodes.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('ha.nodes')}</h3>
              <div className="flex flex-wrap gap-2">
                {nodes.map((n, i) => (
                  <span key={`${n.type}-${n.node}-${i}`} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs">
                    <span className="font-medium text-gray-900 dark:text-zinc-100">{n.node}</span>
                    <span className="text-[10px] uppercase text-gray-400 dark:text-zinc-500">{n.type}</span>
                    {n.status && <span className="text-[10px] text-gray-400 dark:text-zinc-500">· {n.status}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Resource states */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              {t('ha.tab_resources')} <span className="text-gray-400 dark:text-zinc-600">({resources.length})</span>
            </h3>
            {resources.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-zinc-500 py-6 text-center">{t('ha.status_empty')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-700">
                  <thead className="bg-gray-50 dark:bg-zinc-800/60">
                    <tr>
                      <th className={thCls()}>{t('ha.col_sid')}</th>
                      <th className={thCls()}>{t('ha.col_state')}</th>
                      <th className={thCls()}>{t('ha.col_node')}</th>
                      <th className={thCls()}>{t('ha.col_request')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
                    {resources.map((r) => (
                      <tr key={r.sid}>
                        <td className="px-3 py-2 text-xs font-mono text-gray-900 dark:text-zinc-100">{r.sid}</td>
                        <td className="px-3 py-2 text-xs"><HaStateBadge state={r.state} /></td>
                        <td className="px-3 py-2 text-xs text-gray-700 dark:text-zinc-300">{r.node || '–'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">{r.request_state || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
