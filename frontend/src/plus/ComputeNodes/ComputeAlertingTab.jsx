// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { getLicenseStatus } from '../../api/license'
import { fetchNodes } from '../../api/nodes'
import { listGlobalRules, listAlertStates } from '../../api/alerts'

const SEV_STYLE = {
  critical: { dot: 'bg-red-500',    text: 'text-red-700 dark:text-red-400',       label: 'Kritisch' },
  warning:  { dot: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-400', label: 'Warnung' },
}

function PlusGate() {
  return (
    <div className="py-10 flex flex-col items-center gap-3 text-center">
      <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center">
        <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700 dark:text-zinc-200">P3 Plus erforderlich</p>
      <p className="text-xs text-gray-500 dark:text-zinc-400 max-w-xs">
        Alerting und Node-Monitoring sind exklusive Plus-Funktionen.
      </p>
    </div>
  )
}

export default function ComputeAlertingTab({ nodeName, active }) {
  const [isPlus, setIsPlus]       = useState(null)
  const [rules, setRules]         = useState([])
  const [states, setStates]       = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    if (!active || !nodeName) return
    if (loadedFor.current === nodeName) return
    loadedFor.current = nodeName
    setLoading(true)
    setError(null)

    getLicenseStatus()
      .then(async (lic) => {
        const plus = lic?.valid === true
        setIsPlus(plus)
        if (!plus) { setLoading(false); return }

        const [nodesData, rulesData, statesData] = await Promise.allSettled([
          fetchNodes(),
          listGlobalRules(),
          listAlertStates(),
        ])

        const portalNodes = nodesData.status === 'fulfilled' ? nodesData.value : []
        const match = portalNodes.find(n => n.proxmox_node === nodeName || n.name === nodeName)
        const nodeId = match?.id ?? null

        if (nodeId == null) {
          setRules([])
          setStates([])
          setLoading(false)
          return
        }

        if (rulesData.status === 'fulfilled') {
          setRules(rulesData.value.filter(r => r.node_id === nodeId || r.node_id == null))
        } else {
          setError('Alert-Regeln konnten nicht geladen werden.')
        }

        if (statesData.status === 'fulfilled') {
          setStates(statesData.value.filter(s =>
            s.node_id === nodeId &&
            (s.state === 'warning' || s.state === 'critical')
          ))
        }
        setLoading(false)
      })
      .catch(() => {
        setError('Alerting-Daten konnten nicht geladen werden.')
        setLoading(false)
      })
  }, [active, nodeName])

  useEffect(() => {
    loadedFor.current = null
    setRules([])
    setStates([])
    setError(null)
    setIsPlus(null)
  }, [nodeName])

  if (loading || isPlus === null) {
    return (
      <div className="space-y-2">
        {[1, 2].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (!isPlus) return <PlusGate />

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Active Alerts */}
      {states.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Aktive Alerts ({states.length})</h3>
          {states.map(s => {
            const sty = SEV_STYLE[s.severity] ?? SEV_STYLE.warning
            return (
              <div key={`${s.rule_id}-${s.vmid}-${s.severity}`} className="flex items-center gap-3 px-4 py-2.5 text-sm rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30">
                <span className={`w-2 h-2 rounded-full shrink-0 ${sty.dot}`} />
                <span className={`text-xs font-medium ${sty.text}`}>{sty.label}</span>
                <span className="text-xs text-gray-700 dark:text-zinc-300">{s.rule_name}</span>
                <span className="ml-auto text-xs text-gray-500 dark:text-zinc-400 font-mono">VMID {s.vmid}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Rules */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
          Alert-Regeln ({rules.length})
        </h3>
        {rules.length === 0 ? (
          <div className="py-6 text-center text-sm text-gray-400 dark:text-zinc-500">
            Keine Alert-Regeln für diese Node konfiguriert
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Metrik</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Schwellwert</th>
                  <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Schweregrad</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900">
                {rules.map(r => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
                    <td className="px-4 py-2.5 text-xs text-gray-900 dark:text-zinc-100">{r.name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 font-mono">{r.metric}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">{r.threshold}%</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={`${SEV_STYLE[r.severity]?.text ?? 'text-gray-500 dark:text-zinc-400'}`}>
                        {SEV_STYLE[r.severity]?.label ?? r.severity}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
