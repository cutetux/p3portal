// p3portal.org
// PROJ-103 (PVE-9-Pivot): HA-Regeln-Liste + Anlegen/Bearbeiten/Löschen.
// node-affinity (ersetzt Gruppen) + resource-affinity. Anzeige viewer+,
// Schreib-Aktionen nur mit manage_ha (canWrite). Regel-Löschen verwaist keine
// Ressource → einfacher ConfirmModal statt Nutzungs-Dialog. Nie 500: Flags.
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { listHaRules, deleteHaRule } from '../../api/ha'
import { AvailabilityBanner, isUnavailable, haErrMsg, thCls } from './haHelpers'
import HaRuleFormModal from './HaRuleFormModal'
import ConfirmModal from '../common/ConfirmModal'

export default function HaRulesSection({ portalNodeId = null, canWrite = false } = {}) {
  const { t } = useTranslation()
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [formRule, setFormRule] = useState(undefined)  // undefined=closed, null=create, obj=edit
  const [deleteRule, setDeleteRule] = useState(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listHaRules(portalNodeId)
      .then((d) => setResp(d))
      .catch(() => setResp({ cluster_unreachable: true }))
      .finally(() => setLoading(false))
  }, [portalNodeId])

  useEffect(() => { load() }, [load])

  const items = resp?.items ?? []
  const unavailable = isUnavailable(resp)

  const confirmDelete = async () => {
    try {
      await deleteHaRule(deleteRule.id, portalNodeId)
      setDeleteRule(null)
      load()
    } catch (err) {
      setActionError(haErrMsg(err, t))
      setDeleteRule(null)
    }
  }

  const typeLabel = (ty) => t(`ha.rule.type_${String(ty || '').replace('-', '_')}`, ty || '–')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
          {t('ha.tab_rules')} <span className="text-gray-400 dark:text-zinc-600">({items.length})</span>
        </h3>
        {canWrite && (
          <button onClick={() => setFormRule(null)} disabled={unavailable} className="btn-primary text-xs">
            {t('ha.rule.create')}
          </button>
        )}
      </div>

      {actionError && <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{actionError}</p>}
      <AvailabilityBanner resp={resp} />

      {loading && resp == null ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-4">{t('ha.loading')}</p>
      ) : !unavailable && items.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">{t('ha.rule.empty')}</p>
      ) : !unavailable && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-700">
            <thead className="bg-gray-50 dark:bg-zinc-800/60">
              <tr>
                <th className={thCls()}>{t('ha.rule.col_name')}</th>
                <th className={thCls()}>{t('ha.rule.col_type')}</th>
                <th className={thCls()}>{t('ha.rule.col_resources')}</th>
                <th className={thCls()}>{t('ha.rule.col_detail')}</th>
                {canWrite && <th className={thCls()}></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {items.map((r) => (
                <tr key={r.id} className={r.disable ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 text-xs font-mono text-gray-900 dark:text-zinc-100">
                    {r.id}
                    {r.disable && <span className="ml-2 rounded bg-gray-200/60 dark:bg-zinc-700/60 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-zinc-400">{t('ha.rule.disabled_badge')}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="rounded-full bg-portal-info/10 text-portal-info px-2 py-0.5 text-[10px]">{typeLabel(r.type)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-zinc-300">
                    <div className="flex flex-wrap gap-1">
                      {(r.resources ?? []).map((sid) => (
                        <span key={sid} className="inline-flex items-center rounded bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px]">{sid}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400">
                    {r.type === 'resource-affinity' ? (
                      t(`ha.rule.affinity_${r.affinity}`, r.affinity || '–')
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {(r.nodes ?? []).map((n) => (
                          <span key={n.node} className="inline-flex items-center rounded bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px]">
                            {n.node}{n.priority != null && <span className="text-gray-400 dark:text-zinc-500">:{n.priority}</span>}
                          </span>
                        ))}
                        {r.strict && <span className="rounded-full bg-portal-warn/10 text-portal-warn px-2 py-0.5 text-[10px]">{t('ha.rule.strict_badge')}</span>}
                      </div>
                    )}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => setFormRule(r)} className="btn-table">{t('ha.edit')}</button>
                        <button onClick={() => setDeleteRule(r)} className="btn-table-danger">{t('ha.delete')}</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formRule !== undefined && (
        <HaRuleFormModal
          rule={formRule}
          portalNodeId={portalNodeId}
          onClose={() => setFormRule(undefined)}
          onSuccess={load}
        />
      )}
      {deleteRule && (
        <ConfirmModal
          title={t('ha.rule.delete_title', { name: deleteRule.id })}
          body={t('ha.rule.delete_body', { name: deleteRule.id })}
          confirmLabel={t('ha.delete')}
          variant="danger"
          onConfirm={confirmDelete}
          onClose={() => setDeleteRule(null)}
        />
      )}
    </div>
  )
}
