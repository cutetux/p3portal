// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Pool-Detail-Modal mit Members- und Assignments-Tabs (AC-6, AC-13, AC-17-20).
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { poolsApi } from '../api'
import { formatApiError } from '../../../api/errors'
import ConfirmModal from '../../../components/common/ConfirmModal'
import api from '../../../api/client'

function QuotaBar({ label, used, quota }) {
  const { t } = useTranslation()
  const unlimited = quota === 0
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / quota) * 100))
  const over = !unlimited && used > quota
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-gray-500 dark:text-zinc-400">{label}</span>
        <span className={over ? 'text-red-500 font-medium' : 'text-gray-700 dark:text-zinc-300'}>
          {used} / {unlimited ? t('pools.unlimited') : quota}
        </span>
      </div>
      {!unlimited && (
        <div className="h-1.5 bg-gray-100 dark:bg-zinc-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${over ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-orange-400'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ── Members Tab ───────────────────────────────────────────────────────────────

function MembersTab({ pool, nodes, reload }) {
  const { t } = useTranslation()
  const [search, setSearch]     = useState('')
  const [confirm, setConfirm]   = useState(null)
  const [addNodeId, setAddNodeId]   = useState('')
  const [addVmid, setAddVmid]       = useState('')
  const [addType, setAddType]       = useState('vm')
  const [addBusy, setAddBusy]       = useState(false)
  const [addError, setAddError]     = useState('')

  const members = pool?.members ?? []
  const usage   = pool?.usage

  const nodeMap = Object.fromEntries((nodes ?? []).map(n => [n.id, n.name]))

  const filtered = members.filter(m => {
    if (!search) return true
    return String(m.vmid).includes(search) || (nodeMap[m.node_id] ?? '').toLowerCase().includes(search.toLowerCase())
  })

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!addNodeId || !addVmid) return
    setAddBusy(true)
    setAddError('')
    try {
      await poolsApi.addMember(pool.id, {
        resource_type: addType,
        node_id: Number(addNodeId),
        vmid: Number(addVmid),
      })
      setAddVmid('')
      await reload()
    } catch (err) {
      setAddError(formatApiError(err, t('pools.add_member_error')))
    } finally {
      setAddBusy(false)
    }
  }

  const handleRemove = (m) => {
    setConfirm({
      title: t('pools.remove_member_title'),
      body: t('pools.remove_member_confirm', { vmid: m.vmid }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      onConfirm: async () => {
        await poolsApi.removeMember(pool.id, m.node_id, m.vmid)
        await reload()
      },
    })
  }

  return (
    <div className="space-y-4">
      {/* Over-quota banner */}
      {usage?.is_over_quota && (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-lg px-3 py-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {t('pools.over_quota_banner')}
        </div>
      )}

      {/* Quota bars */}
      {usage && (
        <div className="grid grid-cols-2 gap-3 bg-gray-50 dark:bg-zinc-800/50 rounded-lg px-4 py-3">
          <QuotaBar label={t('pools.quota_vm_count')} used={usage.vm_count.used} quota={usage.vm_count.quota} />
          <QuotaBar label={t('pools.quota_cpu')} used={usage.cpu.used} quota={usage.cpu.quota} />
          <QuotaBar label={t('pools.quota_ram_mb')} used={usage.ram_mb.used} quota={usage.ram_mb.quota} />
          <QuotaBar label={t('pools.quota_disk_gb')} used={usage.disk_gb.used} quota={usage.disk_gb.quota} />
        </div>
      )}

      {/* Add member form */}
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">{t('pools.add_member_node')}</label>
          <select
            value={addNodeId}
            onChange={e => setAddNodeId(e.target.value)}
            required
            className="text-sm px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 min-w-[140px]"
          >
            <option value="">{t('pools.add_member_node_placeholder')}</option>
            {(nodes ?? []).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">VM-ID</label>
          <input
            type="number"
            min={100}
            value={addVmid}
            onChange={e => setAddVmid(e.target.value)}
            required
            placeholder="100"
            className="text-sm px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 w-24"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">{t('pools.add_member_type')}</label>
          <select
            value={addType}
            onChange={e => setAddType(e.target.value)}
            className="text-sm px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="vm">VM</option>
            <option value="lxc">LXC</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={addBusy}
          className="btn-primary"
        >
          {addBusy ? '…' : t('pools.add_member_btn')}
        </button>
      </form>
      {addError && <p className="text-xs text-red-500">{addError}</p>}

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('pools.member_search_placeholder')}
        className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
      />

      {/* Members list */}
      <div className="border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">{t('pools.members_empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-800/50 text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="px-3 py-2 text-left">VM-ID</th>
                <th className="px-3 py-2 text-left">{t('pools.col_node')}</th>
                <th className="px-3 py-2 text-left">{t('pools.col_type')}</th>
                <th className="px-3 py-2 text-left">{t('pools.col_added_by')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={`${m.node_id}-${m.vmid}`} className="border-t border-gray-100 dark:border-zinc-800">
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-zinc-100">{m.vmid}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-zinc-400">{nodeMap[m.node_id] ?? m.node_id}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5 rounded">
                      {m.resource_type.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">{m.added_by}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleRemove(m)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      {t('common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && (
        <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  )
}

// ── Assignments Tab ───────────────────────────────────────────────────────────

function AssignmentsTab({ pool, users, groups, presets, reload }) {
  const { t } = useTranslation()
  const [confirm, setConfirm]         = useState(null)
  const [subjectType, setSubjectType] = useState('user')
  const [subjectId, setSubjectId]     = useState('')
  const [presetId, setPresetId]       = useState('')
  const [addBusy, setAddBusy]         = useState(false)
  const [addError, setAddError]       = useState('')

  const assignments = pool?.assignments ?? []

  const subjectOptions = subjectType === 'user'
    ? (users ?? []).filter(u => u.auth_type === 'local' || !u.auth_type)
    : (groups ?? [])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!subjectId || !presetId) return
    setAddBusy(true)
    setAddError('')
    try {
      await poolsApi.addAssignment(pool.id, {
        subject_type: subjectType,
        subject_id: Number(subjectId),
        role_preset_id: Number(presetId),
      })
      setSubjectId('')
      setPresetId('')
      await reload()
    } catch (err) {
      setAddError(formatApiError(err, t('pools.add_assignment_error')))
    } finally {
      setAddBusy(false)
    }
  }

  const handleRemove = (a) => {
    setConfirm({
      title: t('pools.remove_assignment_title'),
      body: t('pools.remove_assignment_confirm'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      onConfirm: async () => {
        await poolsApi.removeAssignment(pool.id, a.subject_type, a.subject_id)
        await reload()
      },
    })
  }

  return (
    <div className="space-y-4">
      {/* Add assignment form */}
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">{t('pools.add_assignment_type')}</label>
          <select
            value={subjectType}
            onChange={e => { setSubjectType(e.target.value); setSubjectId('') }}
            className="text-sm px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400"
          >
            <option value="user">{t('pools.subject_type_user')}</option>
            <option value="group">{t('pools.subject_type_group')}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">
            {subjectType === 'user' ? t('pools.add_assignment_user') : t('pools.add_assignment_group')}
          </label>
          <select
            value={subjectId}
            onChange={e => setSubjectId(e.target.value)}
            required
            className="text-sm px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 min-w-[140px]"
          >
            <option value="">{t('common.select')}…</option>
            {subjectOptions.map(s => (
              <option key={s.id} value={s.id}>{s.username ?? s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 mb-1">{t('pools.add_assignment_preset')}</label>
          <select
            value={presetId}
            onChange={e => setPresetId(e.target.value)}
            required
            className="text-sm px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-400 min-w-[140px]"
          >
            <option value="">{t('common.select')}…</option>
            {(presets ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={addBusy}
          className="btn-primary"
        >
          {addBusy ? '…' : t('pools.add_assignment_btn')}
        </button>
      </form>
      {addError && <p className="text-xs text-red-500">{addError}</p>}

      {/* Assignments list */}
      <div className="border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {assignments.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">{t('pools.assignments_empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-800/50 text-xs text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="px-3 py-2 text-left">{t('pools.col_subject')}</th>
                <th className="px-3 py-2 text-left">{t('pools.col_preset')}</th>
                <th className="px-3 py-2 text-left">{t('pools.col_added_by')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {assignments.map(a => (
                <tr key={a.id} className="border-t border-gray-100 dark:border-zinc-800">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400 px-1.5 py-0.5 rounded">
                        {a.subject_type === 'group' ? t('pools.badge_group') : t('pools.badge_user')}
                      </span>
                      <span className="text-gray-900 dark:text-zinc-100">{a.subject_id}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-500 dark:text-zinc-400">
                    {a.role_preset_name ?? a.role_preset_id}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 dark:text-zinc-500">{a.added_by}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => handleRemove(a)}
                      className="text-xs text-red-400 hover:text-red-600 transition-colors"
                    >
                      {t('common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
    </div>
  )
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function PoolDetailModal({ poolId, users, groups, onClose }) {
  const { t } = useTranslation()
  const [pool, setPool]       = useState(null)
  const [nodes, setNodes]     = useState([])
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [tab, setTab]         = useState('members')

  const load = useCallback(async () => {
    try {
      const data = await poolsApi.get(poolId)
      setPool(data)
    } catch (err) {
      setError(formatApiError(err, t('pools.load_error')))
    } finally {
      setLoading(false)
    }
  }, [poolId, t])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.get('/api/admin/nodes').then(r => setNodes(r.data)).catch(() => {})
    api.get('/api/rbac/presets').then(r => setPresets(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const tabCls = (t) => `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
    tab === t
      ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
      : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
  }`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
              {loading ? '…' : pool?.name}
            </h2>
            {pool?.description && (
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{pool.description}</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <button onClick={() => setTab('members')} className={tabCls('members')}>
            {t('pools.tab_members')} {pool && `(${pool.member_count})`}
          </button>
          <button onClick={() => setTab('assignments')} className={tabCls('assignments')}>
            {t('pools.tab_assignments')} {pool && `(${pool.assignment_count})`}
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">{t('common.loading')}</p>
          ) : error ? (
            <p className="text-sm text-red-400 py-8 text-center">{error}</p>
          ) : tab === 'members' ? (
            <MembersTab pool={pool} nodes={nodes} reload={load} />
          ) : (
            <AssignmentsTab pool={pool} users={users} groups={groups} presets={presets} reload={load} />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button
            onClick={onClose}
            className="btn-secondary"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
