// p3portal.org
// PROJ-103: Laufzeit-Aktion Migrate/Relocate einer HA-Ressource auf eine andere
// Node. Läuft über das Job-System (202) → nach Start Navigation in den Live-Log
// (/events/:id). Ziel-Nodes = andere Nodes der Installation ohne die aktuelle.
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { migrateHaResource, relocateHaResource, getHaStatus } from '../../api/ha'
import { getNodes } from '../../api/cluster'
import { haErrMsg } from './haHelpers'
import { modalInputCls } from '../vms/disks/diskHelpers'

export default function HaMigrateModal({ resource, portalNodeId = null, onClose }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [action, setAction] = useState('migrate')  // 'migrate' | 'relocate'
  const [targetNode, setTargetNode] = useState('')
  const [nodeNames, setNodeNames] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // BUG-103-1: die aktuelle Node der Ressource lebt nur im HA-Status (nicht in der
  // Ressourcen-Config) → hier abfragen und als Migrate-Ziel ausschließen (AC-ACT-3).
  useEffect(() => {
    let active = true
    Promise.all([getNodes(), getHaStatus(portalNodeId).catch(() => null)])
      .then(([list, status]) => {
        if (!active) return
        const currentNode = (status?.resources ?? []).find((r) => r.sid === resource.sid)?.node || null
        const names = (Array.isArray(list) ? list : [])
          .filter((n) => portalNodeId == null || n.portal_node_id === portalNodeId)
          .map((n) => n.node)
          .filter((n) => n && n !== currentNode)
        setNodeNames([...new Set(names)])
      })
      .catch(() => { if (active) setNodeNames([]) })
    return () => { active = false }
  }, [portalNodeId, resource.sid])

  const noTargets = useMemo(() => nodeNames.length === 0, [nodeNames])
  useEffect(() => { setTargetNode((prev) => prev || nodeNames[0] || '') }, [nodeNames])

  const submit = async (e) => {
    e.preventDefault()
    if (!targetNode) { setError(t('ha.migrate.err_no_target')); return }
    setBusy(true)
    setError('')
    try {
      const job = action === 'relocate'
        ? await relocateHaResource(resource.sid, targetNode, portalNodeId)
        : await migrateHaResource(resource.sid, targetNode, portalNodeId)
      onClose?.()
      navigate(`/events/${job.id}`)
    } catch (err) {
      setError(haErrMsg(err, t))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg flex flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t('ha.migrate.title', { sid: resource.sid })}
          </h2>
          <button onClick={onClose} aria-label={t('ha.close')} className="btn-ghost">✕</button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</p>}

          <div>
            <label htmlFor="ha-mig-action" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.migrate.action_label')}</label>
            <select id="ha-mig-action" value={action} onChange={(e) => setAction(e.target.value)} className={modalInputCls}>
              <option value="migrate">{t('ha.migrate.action_migrate')}</option>
              <option value="relocate">{t('ha.migrate.action_relocate')}</option>
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">
              {action === 'relocate' ? t('ha.migrate.relocate_hint') : t('ha.migrate.migrate_hint')}
            </p>
          </div>

          {noTargets ? (
            <p className="text-sm text-gray-500 dark:text-zinc-400 bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 px-3 py-2 rounded">
              {t('ha.migrate.no_targets')}
            </p>
          ) : (
            <div>
              <label htmlFor="ha-mig-target" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('ha.migrate.target_label')}</label>
              <select id="ha-mig-target" value={targetNode} onChange={(e) => setTargetNode(e.target.value)} className={modalInputCls}>
                {nodeNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">{t('ha.cancel')}</button>
            <button type="submit" disabled={busy || noTargets} className="btn-primary">
              {busy ? t('ha.migrate.submitting') : t('ha.migrate.submit')}
            </button>
          </div>
        </form>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
