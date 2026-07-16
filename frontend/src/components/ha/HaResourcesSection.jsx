// p3portal.org
// PROJ-103: HA-Ressourcen-Liste + Hinzufügen/Bearbeiten/Entfernen + Migrate/
// Relocate. Anzeige viewer+, Schreib-Aktionen nur mit manage_ha (canWrite).
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { listHaResources, deleteHaResource } from '../../api/ha'
import { AvailabilityBanner, isUnavailable, haErrMsg, thCls } from './haHelpers'
import HaResourceFormModal from './HaResourceFormModal'
import HaMigrateModal from './HaMigrateModal'
import ConfirmModal from '../common/ConfirmModal'

export default function HaResourcesSection({ portalNodeId = null, canWrite = false } = {}) {
  const { t } = useTranslation()
  const [resp, setResp] = useState(null)
  const [loading, setLoading] = useState(false)
  const [formRes, setFormRes] = useState(undefined)   // undefined=closed, null=create, obj=edit
  const [migrateRes, setMigrateRes] = useState(null)
  const [removeRes, setRemoveRes] = useState(null)
  const [actionError, setActionError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listHaResources(portalNodeId)
      .then((d) => setResp(d))
      .catch(() => setResp({ cluster_unreachable: true }))
      .finally(() => setLoading(false))
  }, [portalNodeId])

  useEffect(() => { load() }, [load])

  const items = resp?.items ?? []
  const unavailable = isUnavailable(resp)

  const confirmRemove = async () => {
    try {
      await deleteHaResource(removeRes.sid, portalNodeId)
      setRemoveRes(null)
      load()
    } catch (err) {
      setActionError(haErrMsg(err, t))
      setRemoveRes(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
          {t('ha.tab_resources')} <span className="text-gray-400 dark:text-zinc-600">({items.length})</span>
        </h3>
        {canWrite && (
          <button onClick={() => setFormRes(null)} disabled={unavailable} className="btn-primary text-xs">
            {t('ha.resource.add')}
          </button>
        )}
      </div>

      {actionError && <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{actionError}</p>}
      <AvailabilityBanner resp={resp} />

      {loading && resp == null ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-4">{t('ha.loading')}</p>
      ) : !unavailable && items.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">{t('ha.resource.empty')}</p>
      ) : !unavailable && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-700">
            <thead className="bg-gray-50 dark:bg-zinc-800/60">
              <tr>
                <th className={thCls()}>{t('ha.col_sid')}</th>
                <th className={thCls()}>{t('ha.resource.col_state')}</th>
                <th className={thCls()}>{t('ha.resource.col_limits')}</th>
                {canWrite && <th className={thCls()}></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {items.map((r) => (
                <tr key={r.sid}>
                  <td className="px-3 py-2 text-xs font-mono text-gray-900 dark:text-zinc-100">{r.sid}</td>
                  <td className="px-3 py-2 text-xs text-gray-700 dark:text-zinc-300">{r.state ? t(`ha.resource.state_${r.state}`, r.state) : '–'}</td>
                  <td className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-400 tabular-nums">
                    {t('ha.resource.limits_fmt', { restart: r.max_restart ?? '–', relocate: r.max_relocate ?? '–' })}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => setMigrateRes(r)} className="btn-table">{t('ha.resource.migrate')}</button>
                        <button onClick={() => setFormRes(r)} className="btn-table">{t('ha.edit')}</button>
                        <button onClick={() => setRemoveRes(r)} className="btn-table-danger">{t('ha.resource.remove')}</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formRes !== undefined && (
        <HaResourceFormModal
          resource={formRes}
          portalNodeId={portalNodeId}
          onClose={() => setFormRes(undefined)}
          onSuccess={load}
        />
      )}
      {migrateRes && (
        <HaMigrateModal resource={migrateRes} portalNodeId={portalNodeId} onClose={() => setMigrateRes(null)} />
      )}
      {removeRes && (
        <ConfirmModal
          title={t('ha.resource.remove_title', { sid: removeRes.sid })}
          body={t('ha.resource.remove_body', { sid: removeRes.sid })}
          confirmLabel={t('ha.resource.remove')}
          variant="danger"
          onConfirm={confirmRemove}
          onClose={() => setRemoveRes(null)}
        />
      )}
    </div>
  )
}
