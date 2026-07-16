// p3portal.org
/**
 * PROJ-42 Phase 1 – Modal to create or fully edit a Core IPAM pool.
 *
 * A pool is bound to one network via the identity (kind, network_name, node,
 * vlan_tag). The network is picked from the node's vm-options (bridges +
 * SDN-VNets, same source as the deploy form) with a free-text fallback. Picking
 * a bridge keeps the node (node-scoped); picking a VNet clears it (cluster-wide).
 * CIDR is required; gateway/DNS/range/description are optional. Client-side IPv4
 * validation mirrors the backend; the server is the real boundary (409 on a
 * duplicate subnet is surfaced verbatim).
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getNodes, getNodeVmOptions } from '../../api/cluster'
import { createPool, updatePool } from '../../api/ipam'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls = 'space-y-1'

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

function isIpv4(s) {
  if (!IPV4_RE.test(s)) return false
  return s.split('.').every(o => { const n = Number(o); return n >= 0 && n <= 255 })
}

function buildInitial(pool) {
  if (!pool) {
    return {
      kind: 'bridge', networkName: '', node: '', vlanTag: '',
      cidr: '', gateway: '', dns: '', rangeStart: '', rangeEnd: '', description: '',
      custom: false,
    }
  }
  return {
    kind: pool.kind ?? 'bridge',
    networkName: pool.network_name ?? '',
    node: pool.node ?? '',
    vlanTag: pool.vlan_tag != null ? String(pool.vlan_tag) : '',
    cidr: pool.cidr ?? '',
    gateway: pool.gateway ?? '',
    dns: Array.isArray(pool.dns) ? pool.dns.join(', ') : '',
    rangeStart: pool.range_start ?? '',
    rangeEnd: pool.range_end ?? '',
    description: pool.description ?? '',
    custom: true, // edit: show name as free text (network may not be on current node list)
  }
}

function errMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 409) return typeof d === 'string' ? d : t('ipam.pool.err_409')
  if (s === 403) return t('ipam.pool.err_403')
  if (s === 422) return typeof d === 'string' ? d : t('ipam.pool.err_422')
  return (typeof d === 'string' ? d : null) ?? t('ipam.pool.err_generic')
}

export default function IpamPoolFormModal({ pool, onClose, onSuccess }) {
  const { t } = useTranslation()
  const isEdit = Boolean(pool)
  const [form, setForm] = useState(() => buildInitial(pool))
  const [nodes, setNodes] = useState([])
  const [options, setOptions] = useState({ bridges: [], vnets: [] })
  const [optLoading, setOptLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))

  // Member-node list for the node selector (bridges are node-scoped).
  useEffect(() => {
    getNodes().then(list => setNodes(Array.isArray(list) ? list : [])).catch(() => setNodes([]))
  }, [])

  // Load bridges/vnets for the selected node (same source as the deploy form).
  useEffect(() => {
    if (!form.node) { setOptions({ bridges: [], vnets: [] }); return }
    setOptLoading(true)
    getNodeVmOptions(form.node)
      .then(data => setOptions({
        bridges: Array.isArray(data?.bridges) ? data.bridges : [],
        vnets: Array.isArray(data?.vnets) ? data.vnets : [],
      }))
      .catch(() => setOptions({ bridges: [], vnets: [] }))
      .finally(() => setOptLoading(false))
  }, [form.node])

  const netNames = useMemo(
    () => [...(options.bridges || []), ...(options.vnets || [])],
    [options],
  )
  // Free-text mode if the user picked it, or the current name is not on the node.
  const showCustom = form.custom || (!!form.networkName && !netNames.includes(form.networkName))

  // Pick a network from the dropdown → derive kind (+ clear node for a vnet).
  function pickNetwork(name) {
    if (name === '__custom__') { setForm(prev => ({ ...prev, custom: true })); return }
    const isVnet = (options.vnets || []).includes(name)
    setForm(prev => ({
      ...prev,
      custom: false,
      networkName: name,
      kind: isVnet ? 'vnet' : 'bridge',
      vlanTag: isVnet ? '' : prev.vlanTag,
    }))
  }

  function validate() {
    if (!form.networkName.trim()) return t('ipam.pool.network_required')
    if (form.kind === 'bridge' && !form.node) return t('ipam.pool.node_required')
    if (!CIDR_RE.test(form.cidr.trim())) return t('ipam.pool.cidr_invalid')
    for (const [key, label] of [['gateway', 'gateway'], ['rangeStart', 'range_start'], ['rangeEnd', 'range_end']]) {
      const v = form[key].trim()
      if (v && !isIpv4(v)) return t('ipam.pool.ipv4_invalid', { field: label })
    }
    return ''
  }

  function buildPayload() {
    const vnet = form.kind === 'vnet'
    const dns = form.dns.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    return {
      kind: form.kind,
      network_name: form.networkName.trim(),
      node: vnet ? null : (form.node || null),
      vlan_tag: vnet || !form.vlanTag ? null : parseInt(form.vlanTag, 10),
      cidr: form.cidr.trim(),
      gateway: form.gateway.trim() || null,
      dns: dns.length ? dns : null,
      range_start: form.rangeStart.trim() || null,
      range_end: form.rangeEnd.trim() || null,
      description: form.description.trim() || null,
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const v = validate()
    if (v) { setError(v); return }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload()
      if (isEdit) await updatePool(pool.id, payload)
      else await createPool(payload)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-xl rounded-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ipam-pool-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="ipam-pool-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('ipam.pool.title_edit') : t('ipam.pool.title_new')}
          </h2>
          <button onClick={onClose} aria-label={t('common.close')} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form id="ipam-pool-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
          )}

          {/* Node */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="ipam-node">{t('ipam.pool.field_node')}</label>
            <select id="ipam-node" value={form.node} onChange={set('node')} className={inputCls}>
              <option value="">{t('ipam.pool.node_select')}</option>
              {nodes.map(n => <option key={n.node} value={n.node}>{n.node}</option>)}
            </select>
            <p className={smallCls}>{t('ipam.pool.node_hint')}</p>
          </div>

          {/* Network */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="ipam-net">{t('ipam.pool.field_network')} <span className="text-portal-danger">*</span></label>
            {!showCustom ? (
              <select
                id="ipam-net"
                value={form.networkName || ''}
                onChange={e => pickNetwork(e.target.value)}
                disabled={optLoading}
                className={inputCls}
              >
                <option value="">{optLoading ? t('common.loading') : t('ipam.pool.network_select')}</option>
                {options.bridges?.length > 0 && (
                  <optgroup label={t('ipam.pool.group_bridges')}>
                    {options.bridges.map(b => <option key={`b-${b}`} value={b}>{b}</option>)}
                  </optgroup>
                )}
                {options.vnets?.length > 0 && (
                  <optgroup label={t('ipam.pool.group_vnets')}>
                    {options.vnets.map(v => <option key={`v-${v}`} value={v}>{v}</option>)}
                  </optgroup>
                )}
                <option value="__custom__">{t('ipam.pool.network_custom')}</option>
              </select>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <select value={form.kind} onChange={set('kind')} className={`${inputCls} col-span-1`}>
                  <option value="bridge">{t('ipam.pool.kind_bridge')}</option>
                  <option value="vnet">{t('ipam.pool.kind_vnet')}</option>
                </select>
                <input
                  type="text"
                  value={form.networkName}
                  onChange={set('networkName')}
                  placeholder={t('ipam.pool.network_ph')}
                  className={`${inputCls} col-span-2`}
                />
              </div>
            )}
            <p className={smallCls}>{t('ipam.pool.network_hint')}</p>
          </div>

          {/* VLAN tag – only for bridges (a vnet encapsulates its own VLAN) */}
          {form.kind === 'bridge' && (
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="ipam-vlan">{t('ipam.pool.field_vlan')}</label>
              <input id="ipam-vlan" type="number" min="1" max="4094" value={form.vlanTag} onChange={set('vlanTag')} placeholder={t('ipam.pool.vlan_ph')} className={inputCls} />
              <p className={smallCls}>{t('ipam.pool.vlan_hint')}</p>
            </div>
          )}

          {/* CIDR */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="ipam-cidr">{t('ipam.pool.field_cidr')} <span className="text-portal-danger">*</span></label>
            <input id="ipam-cidr" type="text" value={form.cidr} onChange={set('cidr')} placeholder="192.168.2.0/24" className={inputCls} />
          </div>

          {/* Gateway */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="ipam-gw">{t('ipam.pool.field_gateway')}</label>
            <input id="ipam-gw" type="text" value={form.gateway} onChange={set('gateway')} placeholder="192.168.2.1" className={inputCls} />
          </div>

          {/* Range */}
          <div className="grid grid-cols-2 gap-3">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="ipam-rs">{t('ipam.pool.field_range_start')}</label>
              <input id="ipam-rs" type="text" value={form.rangeStart} onChange={set('rangeStart')} placeholder="192.168.2.10" className={inputCls} />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="ipam-re">{t('ipam.pool.field_range_end')}</label>
              <input id="ipam-re" type="text" value={form.rangeEnd} onChange={set('rangeEnd')} placeholder="192.168.2.200" className={inputCls} />
            </div>
          </div>

          {/* DNS */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="ipam-dns">{t('ipam.pool.field_dns')}</label>
            <input id="ipam-dns" type="text" value={form.dns} onChange={set('dns')} placeholder="1.1.1.1, 8.8.8.8" className={inputCls} />
            <p className={smallCls}>{t('ipam.pool.dns_hint')}</p>
          </div>

          {/* Description */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="ipam-desc">{t('ipam.pool.field_description')}</label>
            <input id="ipam-desc" type="text" value={form.description} onChange={set('description')} className={inputCls} />
          </div>
        </form>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" form="ipam-pool-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? t('common.save') : t('ipam.pool.create')}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
