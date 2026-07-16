// p3portal.org
/**
 * PROJ-42 Phase 1 – Core IPAM pool management (admin-only in Core).
 *
 * Lists IP pools bound to a network and offers create/edit/delete. This is the
 * whole Core surface: stateless best-effort IPAM, no allocations/grants/toggles
 * (that is Phase 2 / Plus). Rendered as the "IPAM" area of the Netzwerk page.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { listPools, deletePool } from '../../api/ipam'
import IpamPoolFormModal from './IpamPoolFormModal'
import ConfirmModal from '../common/ConfirmModal'

// Human label for a pool's bound network: "vmbr0 (pve1 · VLAN 10)" / "guests (cluster-wide)".
function networkLabel(pool, t) {
  const parts = []
  if (pool.node) parts.push(pool.node)
  else if (pool.kind === 'vnet') parts.push(t('ipam.pool.cluster_wide'))
  if (pool.vlan_tag) parts.push(`VLAN ${pool.vlan_tag}`)
  const suffix = parts.length ? ` (${parts.join(' · ')})` : ''
  return `${pool.network_name}${suffix}`
}

export default function IpamPoolsTab() {
  const { t } = useTranslation()
  const [pools, setPools] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formPool, setFormPool] = useState(null) // {} = new, pool = edit
  const [showForm, setShowForm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPools(await listPools())
    } catch (err) {
      const d = err?.response?.data?.detail
      setError(typeof d === 'string' ? d : t('ipam.pool.load_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const openNew = () => { setFormPool(null); setShowForm(true) }
  const openEdit = (pool) => { setFormPool(pool); setShowForm(true) }

  const handleDelete = async () => {
    await deletePool(deleteTarget.id)
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-zinc-400 max-w-2xl">
          {t('ipam.description')}
        </p>
        <button onClick={openNew} className="btn-primary shrink-0 flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t('ipam.pool.add')}
        </button>
      </div>

      {error && (
        <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
      )}

      <div className="border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-zinc-400 border-b border-gray-200 dark:border-zinc-700">
                <th className="px-4 py-2.5 font-medium">{t('ipam.pool.col_network')}</th>
                <th className="px-4 py-2.5 font-medium">{t('ipam.pool.col_cidr')}</th>
                <th className="px-4 py-2.5 font-medium">{t('ipam.pool.col_gateway')}</th>
                <th className="px-4 py-2.5 font-medium">{t('ipam.pool.col_range')}</th>
                <th className="px-4 py-2.5 font-medium">{t('ipam.pool.col_description')}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500">{t('common.loading')}</td></tr>
              )}
              {!loading && pools.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-zinc-500">{t('ipam.pool.empty')}</td></tr>
              )}
              {!loading && pools.map(pool => (
                <tr key={pool.id} className="border-b border-gray-100 dark:border-zinc-800 last:border-0 text-gray-800 dark:text-zinc-200">
                  <td className="px-4 py-2.5 whitespace-nowrap font-medium">{networkLabel(pool, t)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">{pool.cidr}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">{pool.gateway || '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap font-mono text-xs">
                    {pool.range_start || pool.range_end ? `${pool.range_start || '…'}–${pool.range_end || '…'}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-zinc-400">{pool.description || '—'}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => openEdit(pool)} className="btn-table">{t('common.edit')}</button>
                      <button onClick={() => setDeleteTarget(pool)} className="btn-table-danger">{t('common.delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <IpamPoolFormModal
          pool={formPool}
          onClose={() => setShowForm(false)}
          onSuccess={load}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={t('ipam.pool.delete_title')}
          body={t('ipam.pool.delete_body', { network: networkLabel(deleteTarget, t) })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
