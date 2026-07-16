// p3portal.org
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { availablePools, suggestFreeIp } from '../../api/ipam'

function parseIpConfig(value) {
  if (!value || value === 'ip=dhcp') return { mode: 'dhcp', ip: '', prefix: '24', gateway: '' }
  const match = value.match(/ip=([^/]+)\/(\d+)(?:,gw=(.+))?/)
  if (match) return { mode: 'static', ip: match[1], prefix: match[2], gateway: match[3] ?? '' }
  return { mode: 'dhcp', ip: '', prefix: '24', gateway: '' }
}

function buildValue(mode, ip, prefix, gateway) {
  if (mode === 'dhcp') return 'ip=dhcp'
  if (!ip) return 'ip=dhcp'
  return gateway ? `ip=${ip}/${prefix},gw=${gateway}` : `ip=${ip}/${prefix}`
}

// PROJ-42: if the playbook has a network field (type proxmox_bridge) and a node
// field, we can pre-select the pool bound to that exact network. This is a
// convenience only — the pool dropdown always lists every available pool, so
// IPAM works even for playbooks without a bridge field (e.g. the starter-pack,
// where the network is inherited from the template).
function resolveNetwork(params, formValues) {
  if (!params || !formValues) return { networkName: '', node: '' }
  const bridgeParam = params.find(p => p.type === 'proxmox_bridge')
  const nodeParam = params.find(p => p.type === 'proxmox_node')
  return {
    networkName: bridgeParam ? (formValues[bridgeParam.id] || '') : '',
    node: nodeParam ? (formValues[nodeParam.id] || '') : '',
  }
}

// Human label for a pool option: "192.168.2.0/24 · vmbr0 (pve-01) – Prod".
function poolLabel(p) {
  const net = p.node ? `${p.network_name} (${p.node})` : p.network_name
  const desc = p.description ? ` – ${p.description}` : ''
  return `${p.cidr} · ${net}${desc}`
}

export default function IpConfigField({ param, value, onChange, error, formValues, params }) {
  const { t } = useTranslation()
  const parsed = parseIpConfig(value)
  const [mode, setMode] = useState(parsed.mode)
  const [ip, setIp] = useState(parsed.ip)
  const [prefix, setPrefix] = useState(parsed.prefix)
  const [gateway, setGateway] = useState(parsed.gateway)

  // PROJ-42 IPAM pool picker state
  const [pools, setPools] = useState([])
  const [selectedPoolId, setSelectedPoolId] = useState(null)
  const [poolsLoaded, setPoolsLoaded] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestNote, setSuggestNote] = useState('')

  const { networkName, node } = useMemo(
    () => resolveNetwork(params, formValues),
    [params, formValues],
  )

  useEffect(() => {
    if (!value) onChange(param.id, 'ip=dhcp')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load all available pools once the user starts entering a static IP.
  useEffect(() => {
    if (mode !== 'static' || poolsLoaded) return
    let cancelled = false
    availablePools()
      .then(list => { if (!cancelled) { setPools(Array.isArray(list) ? list : []); setPoolsLoaded(true) } })
      .catch(() => { if (!cancelled) { setPools([]); setPoolsLoaded(true) } })
    return () => { cancelled = true }
  }, [mode, poolsLoaded])

  // Pre-select the pool bound to the chosen network (convenience). A bridge pool
  // must also match the node; a vnet pool is cluster-wide. Only auto-select when
  // the user hasn't picked one yet and the match is unique.
  useEffect(() => {
    if (!networkName || selectedPoolId != null || pools.length === 0) return
    const matches = pools.filter(p =>
      p.network_name === networkName && (p.kind === 'vnet' || !p.node || p.node === node)
    )
    if (matches.length === 1) setSelectedPoolId(matches[0].id)
  }, [networkName, node, pools, selectedPoolId])

  function update(newMode, newIp, newPrefix, newGateway) {
    onChange(param.id, buildValue(newMode, newIp, newPrefix, newGateway))
  }

  function handleMode(m) {
    setMode(m)
    update(m, ip, prefix, gateway)
  }

  const handleSuggest = useCallback(async () => {
    const pool = pools.find(p => p.id === selectedPoolId)
    if (!pool) return
    setSuggesting(true)
    setSuggestNote('')
    try {
      const res = await suggestFreeIp(pool.id)
      if (!res?.ip) {
        setSuggestNote(res?.reason === 'pool_exhausted' ? t('ipam.deploy.exhausted') : t('ipam.deploy.none'))
        return
      }
      const newPrefix = String(pool.cidr.split('/')[1] ?? prefix)
      const newGateway = pool.gateway || gateway
      setIp(res.ip); setPrefix(newPrefix); setGateway(newGateway)
      update('static', res.ip, newPrefix, newGateway)
    } catch {
      setSuggestNote(t('ipam.deploy.error'))
    } finally {
      setSuggesting(false)
    }
  }, [pools, selectedPoolId, prefix, gateway]) // eslint-disable-line react-hooks/exhaustive-deps

  const base =
    'border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 ' +
    'focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  const hasPools = pools.length > 0

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>

      <select
        value={mode}
        onChange={e => handleMode(e.target.value)}
        className={`w-full ${base}`}
      >
        <option value="dhcp">DHCP (automatisch)</option>
        <option value="static">Statisch</option>
      </select>

      {mode === 'static' && (
        <>
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-7 space-y-1">
              <label className="block text-xs text-gray-500 dark:text-zinc-400">IP-Adresse</label>
              <input
                type="text"
                value={ip}
                onChange={e => { setIp(e.target.value); update(mode, e.target.value, prefix, gateway) }}
                placeholder="192.168.1.100"
                className={`w-full ${base} ${error ? 'border-portal-danger' : ''}`}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <label className="block text-xs text-gray-500 dark:text-zinc-400">Präfix</label>
              <input
                type="number"
                value={prefix}
                min={1}
                max={32}
                onChange={e => { setPrefix(e.target.value); update(mode, ip, e.target.value, gateway) }}
                className={`w-full ${base}`}
              />
            </div>
            <div className="col-span-3 space-y-1">
              <label className="block text-xs text-gray-500 dark:text-zinc-400">Gateway</label>
              <input
                type="text"
                value={gateway}
                onChange={e => { setGateway(e.target.value); update(mode, ip, prefix, e.target.value) }}
                placeholder="192.168.1.1"
                className={`w-full ${base}`}
              />
            </div>
          </div>

          {/* PROJ-42: pick an IPAM pool and let P3 suggest a free IP (best-effort).
              Shown whenever at least one pool exists — independent of a bridge field. */}
          {hasPools && (
            <div className="space-y-1.5 pt-1">
              <label className="block text-xs text-gray-500 dark:text-zinc-400">{t('ipam.deploy.pool_label')}</label>
              <div className="flex items-center gap-2">
                <select
                  value={selectedPoolId ?? ''}
                  onChange={e => { setSelectedPoolId(e.target.value ? Number(e.target.value) : null); setSuggestNote('') }}
                  className={`flex-1 ${base}`}
                  aria-label={t('ipam.deploy.pool_label')}
                >
                  <option value="">{t('ipam.deploy.pool_select')}</option>
                  {pools.map(p => (
                    <option key={p.id} value={p.id}>{poolLabel(p)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleSuggest}
                  disabled={suggesting || selectedPoolId == null}
                  className="btn-secondary shrink-0 flex items-center gap-1.5 disabled:opacity-40"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${suggesting ? 'animate-spin' : ''}`}>
                    <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  {t('ipam.deploy.suggest_btn')}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-zinc-500">{t('ipam.deploy.best_effort_hint')}</p>
              {suggestNote && <p className="text-xs text-portal-warn">{suggestNote}</p>}
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-portal-danger">{error}</p>}
    </div>
  )
}
