// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect } from 'react'
import api from '../../api/client'

const ACTIONS = [
  { value: 'start',    label: 'Starten' },
  { value: 'stop',     label: 'Stoppen (Zwangs-Aus)' },
  { value: 'shutdown', label: 'Herunterfahren (ACPI)' },
  { value: 'reboot',   label: 'Neustarten' },
  { value: 'suspend',  label: 'Suspendieren' },
  { value: 'resume',   label: 'Fortsetzen (Resume)' },
]

const inputCls = 'w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500'
const timeCls  = 'text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500'

function cronToTime(cron) {
  if (!cron) return ''
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return ''
  const [min, hour] = parts
  if (!/^\d+$/.test(hour) || !/^\d+$/.test(min)) return ''
  return `${String(parseInt(hour)).padStart(2, '0')}:${String(parseInt(min)).padStart(2, '0')}`
}

function timeToCron(time) {
  const [hStr = '0', mStr = '0'] = (time || '').split(':')
  return `${parseInt(mStr) || 0} ${parseInt(hStr) || 0} * * *`
}

export default function PowerActionJobForm({
  config,
  onChange,
  windowMode,
  onWindowModeChange,
  windowStartCron,
  onWindowStartCronChange,
  windowStopCron,
  onWindowStopCronChange,
}) {
  const [nodes, setNodes] = useState([])
  const [vms, setVms] = useState([])
  const [loadingVms, setLoadingVms] = useState(false)

  useEffect(() => {
    api.get('/api/cluster/nodes').then(({ data }) => setNodes(data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!config.node) { setVms([]); return }
    setLoadingVms(true)
    api.get('/api/cluster/vms').then(({ data }) => {
      setVms(data.filter(v => v.node === config.node))
    }).catch(() => setVms([])).finally(() => setLoadingVms(false))
  }, [config.node])

  const set = (key, val) => onChange({ ...config, [key]: val })

  const handleNodeChange = (node) => {
    onChange({ ...config, node, vmid: '', vmtype: 'qemu' })
  }

  const handleVmChange = (vmid) => {
    const vm = vms.find(v => String(v.vmid) === String(vmid))
    if (vm) onChange({ ...config, vmid: Number(vmid), vmtype: vm.type ?? 'qemu' })
    else set('vmid', Number(vmid) || '')
  }

  const startTime = cronToTime(windowStartCron) || '08:00'
  const stopTime  = cronToTime(windowStopCron)  || '20:00'

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          Node <span className="text-red-500">*</span>
        </label>
        <select value={config.node ?? ''} onChange={e => handleNodeChange(e.target.value)} className={inputCls}>
          <option value="">– Node wählen –</option>
          {nodes.map(n => (
            <option key={n.node} value={n.node}>{n.node}{n.status !== 'online' ? ' (offline)' : ''}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          VM / LXC <span className="text-red-500">*</span>
        </label>
        {loadingVms ? (
          <div className={`${inputCls} text-gray-400 dark:text-zinc-500`}>Lädt VMs…</div>
        ) : (
          <select
            value={config.vmid ?? ''}
            onChange={e => handleVmChange(e.target.value)}
            disabled={!config.node}
            className={`${inputCls} disabled:opacity-50`}
          >
            <option value="">– VM/LXC wählen –</option>
            {vms.map(v => (
              <option key={v.vmid} value={v.vmid}>
                {v.name ?? `VM ${v.vmid}`} ({v.vmid}) [{v.type ?? 'qemu'}] – {v.status}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Betriebsfenster-Toggle */}
      <div className="flex items-center gap-3 pt-1">
        <input
          type="checkbox"
          id="window-mode-toggle"
          checked={windowMode}
          onChange={e => onWindowModeChange(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
        />
        <label htmlFor="window-mode-toggle" className="text-sm text-gray-700 dark:text-zinc-300">
          Betriebsfenster (VM automatisch starten &amp; stoppen)
        </label>
      </div>

      {windowMode ? (
        <div className="space-y-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/50 rounded-lg p-4">
          <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
            Die VM startet und stoppt täglich zu den angegebenen Zeiten.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                Startzeit <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={e => onWindowStartCronChange(timeToCron(e.target.value))}
                className={timeCls}
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500 font-mono">{timeToCron(startTime)}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                Stoppzeit <span className="text-red-500">*</span>
              </label>
              <input
                type="time"
                value={stopTime}
                onChange={e => onWindowStopCronChange(timeToCron(e.target.value))}
                className={timeCls}
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500 font-mono">{timeToCron(stopTime)}</p>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
            Aktion <span className="text-red-500">*</span>
          </label>
          <select value={config.action ?? 'start'} onChange={e => set('action', e.target.value)} className={inputCls}>
            {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}
