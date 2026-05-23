// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Admin-Seite für Pools mit Ressourcen-Quotas.
// PROJ-62: Nach frontend/src/plus/Pools/ verschoben (Plus-Modul).
// Route: /admin/pools (sichtbar nur mit manage_pools oder admin + Plus-Lizenz)
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { usePools } from './hooks/usePools'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'
import { fetchUsers } from '../../api/admin'
import PoolFormModal from './components/PoolFormModal'
import PoolDetailModal from './components/PoolDetailModal'
import DeletePoolConfirmModal from './components/DeletePoolConfirmModal'
import api from '../../api/client'

// PROJ-62: AC-CLEANUP-6 – Badge für Pools ohne Owner
function OwnerlessBadge() {
  return (
    <span
      title="Kein Owner zugewiesen"
      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40 font-medium whitespace-nowrap"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-2.5 h-2.5">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        <line x1="17" y1="11" x2="22" y2="11" />
      </svg>
      Ownerless
    </span>
  )
}

function QuotaCell({ used, quota }) {
  if (quota === 0) return <span className="text-gray-400 dark:text-zinc-500">{used} / ∞</span>
  const pct  = Math.min(100, Math.round((used / quota) * 100))
  const over = used > quota
  return (
    <div className="min-w-[4rem]">
      <div className={`text-xs mb-0.5 ${over ? 'text-red-500 font-medium' : 'text-gray-600 dark:text-zinc-400'}`}>
        {used}/{quota}
      </div>
      <div className="h-1 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-orange-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function PoolsPage({ embedded = false }) {
  const { t } = useTranslation()
  const { pools, loading, error, filters, setFilters, reload } = usePools()
  const { isPlus } = useLicenseLimits()

  const [users, setUsers]   = useState([])
  const [groups, setGroups] = useState([])
  const [modal, setModal]   = useState(null)
  const [tagFilterInput, setTagFilterInput] = useState('')

  const loadUsers = useCallback(() => {
    fetchUsers().then(setUsers).catch(() => {})
    api.get('/api/groups').then(r => setGroups(r.data)).catch(() => {})
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const handleSuccess = () => {
    setModal(null)
    reload()
  }

  const applyTagFilter = () => setFilters(f => ({ ...f, tag: tagFilterInput }))
  const clearFilters = () => {
    setFilters({ search: '', no_owner: false, tag: '' })
    setTagFilterInput('')
  }
  const hasActiveFilter = filters.search || filters.no_owner || filters.tag

  // Core-Edition: Plus required for new pools (CORE_MAX_POOLS = 0)
  const canCreate = isPlus

  const innerContent = (
    <div className="space-y-4">

      {/* Core-edition banner (new pools blocked, existing pools still work) */}
      {!isPlus && pools.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg px-4 py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {t('pools.core_downgrade_banner')}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-2">
        {/* Search */}
        <div className="flex-1 min-w-[180px]">
          <input
            type="text"
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            placeholder={t('pools.search_placeholder')}
            className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        {/* Tag filter */}
        <div className="flex gap-1">
          <input
            type="text"
            value={tagFilterInput}
            onChange={e => setTagFilterInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyTagFilter() }}
            placeholder={t('pools.tag_filter_placeholder')}
            className="text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 w-36"
          />
          <button
            onClick={applyTagFilter}
            className="btn-secondary"
          >
            #
          </button>
        </div>

        {/* No-owner filter */}
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={filters.no_owner}
            onChange={e => setFilters(f => ({ ...f, no_owner: e.target.checked }))}
            className="rounded border-gray-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-400"
          />
          {t('pools.filter_no_owner')}
        </label>

        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
          >
            {t('pools.filter_clear')}
          </button>
        )}

        <div className="flex-1" />

        {/* New pool button */}
        <div className="relative group">
          <button
            onClick={() => canCreate && setModal('create')}
            disabled={!canCreate}
            className="btn-primary flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('pools.create_btn')}
          </button>
          {!canCreate && (
            <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-64 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2.5 py-1.5 shadow-lg pointer-events-none">
              {t('pools.plus_required_tooltip')}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-10 text-center">{t('common.loading')}</p>
        ) : error ? (
          <p className="text-sm text-red-400 py-10 text-center">{error}</p>
        ) : pools.length === 0 ? (
          <div className="py-14 text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
              <rect x="2" y="7" width="20" height="14" rx="2" />
              <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
              <line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" />
            </svg>
            <p className="text-sm text-gray-400 dark:text-zinc-500">
              {hasActiveFilter ? t('pools.empty_filtered') : t('pools.empty')}
            </p>
            {!hasActiveFilter && canCreate && (
              <button
                onClick={() => setModal('create')}
                className="mt-3 text-sm text-orange-500 hover:text-orange-700 transition-colors"
              >
                {t('pools.create_first')}
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/50 text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left">{t('pools.col_name')}</th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">{t('pools.col_tags')}</th>
                  <th className="px-4 py-3 text-center">{t('pools.col_members')}</th>
                  <th className="px-4 py-3 text-left hidden md:table-cell">{t('pools.col_quota_vms')}</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">{t('pools.col_quota_cpu')}</th>
                  <th className="px-4 py-3 text-left hidden lg:table-cell">{t('pools.col_quota_ram')}</th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">{t('pools.col_created')}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {pools.map(p => (
                  <tr
                    key={p.id}
                    className="border-t border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/30"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-gray-900 dark:text-zinc-100">{p.name}</p>
                        {/* PROJ-62: AC-CLEANUP-6 – ownerless-Badge */}
                        {!p.owner_subject_id && <OwnerlessBadge />}
                      </div>
                      {p.description && (
                        <p className="text-xs text-gray-400 dark:text-zinc-500 truncate max-w-xs">{p.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(p.tags ?? []).slice(0, 2).map(tag => (
                          <span key={tag} className="text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full">{tag}</span>
                        ))}
                        {(p.tags ?? []).length > 2 && (
                          <span className="text-xs text-gray-400 dark:text-zinc-500">+{p.tags.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => setModal({ mode: 'detail', pool: p })}
                        className="text-xs text-orange-500 hover:text-orange-700 dark:hover:text-orange-300 font-medium transition-colors"
                      >
                        {p.member_count}
                      </button>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <QuotaCell
                        used={p.used_vm_count ?? 0}
                        quota={p.vm_count_quota}
                      />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <QuotaCell
                        used={p.used_cpu ?? 0}
                        quota={p.cpu_quota}
                      />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <QuotaCell
                        used={p.used_ram_mb ?? 0}
                        quota={p.ram_quota_mb}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500 hidden xl:table-cell">
                      {p.created_at?.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setModal({ mode: 'detail', pool: p })}
                          className="btn-table"
                        >
                          {t('pools.action_members')}
                        </button>
                        <button
                          onClick={() => setModal({ mode: 'edit', pool: p })}
                          className="btn-table"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => setModal({ mode: 'delete', pool: p })}
                          className="btn-table-danger"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  )

  const modals = (
    <>
      {modal === 'create' && (
        <PoolFormModal
          pool={null}
          users={users}
          groups={groups}
          onSuccess={handleSuccess}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'edit' && (
        <PoolFormModal
          pool={modal.pool}
          users={users}
          groups={groups}
          onSuccess={handleSuccess}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'detail' && (
        <PoolDetailModal
          poolId={modal.pool.id}
          users={users}
          groups={groups}
          onClose={() => { setModal(null); reload() }}
        />
      )}
      {modal?.mode === 'delete' && (
        <DeletePoolConfirmModal
          pool={modal.pool}
          onSuccess={handleSuccess}
          onClose={() => setModal(null)}
        />
      )}
      <span className="rq hidden" aria-hidden="true" />
    </>
  )

  if (embedded) {
    return <>{innerContent}{modals}</>
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('pools.title')}</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        <div className="max-w-6xl mx-auto">
          {innerContent}
        </div>
      </div>

      {modals}
    </div>
  )
}
