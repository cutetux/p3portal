// p3portal.org
/**
 * PROJ-103: "Hochverfügbarkeit" (HA) page – cluster-wide HA management behind one
 * sidebar entry. Three areas via URL `?area=`:
 *   1. Status     – Quorum + CRM/LRM manager + per-resource states (read-only).
 *   2. Gruppen    – HA groups (node priorities, restricted, nofailback).
 *   3. Ressourcen – HA resources (VM/CT desired state + migrate/relocate).
 *
 * Anzeige für viewer+ (read-only); Schreiben erfordert `manage_ha` (server-side
 * `_assert_ha_access` is the real boundary — this is the cosmetic content gate too).
 * HA is per-installation (like SDN): the installation selector appears only with
 * more than one Proxmox installation. The sidebar hides this page entirely on
 * standalone/single-node setups (AC-GATE-1).
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import { getNodes } from '../../api/cluster'
import HaStatusTab from '../../components/ha/HaStatusTab'
import HaRulesSection from '../../components/ha/HaRulesSection'
import HaResourcesSection from '../../components/ha/HaResourcesSection'
import Watermark from '../../components/common/Watermark'
import HelpButton from '../../features/help/components/HelpButton'

export default function HaPage() {
  const { t } = useTranslation()
  const { role, portalPermissions } = useAuth()
  const isAdmin = role === 'admin'
  const canWrite = isAdmin || (portalPermissions ?? []).includes('manage_ha')

  const [searchParams, setSearchParams] = useSearchParams()
  const requestedArea = searchParams.get('area')
  const area = ['status', 'rules', 'resources'].includes(requestedArea) ? requestedArea : 'status'

  function setArea(next) {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('area', next)
      return p
    })
  }

  // Installations = distinct portal nodes (each = one Proxmox installation with its
  // own /cluster/ha). Selector only shows with >1 installation (Muster NetworkPage).
  const [rawNodes, setRawNodes] = useState([])
  const [selectedInstallation, setSelectedInstallation] = useState(null)  // portal_node_id
  const [nodesLoading, setNodesLoading] = useState(false)

  useEffect(() => {
    setNodesLoading(true)
    getNodes()
      .then((list) => setRawNodes(Array.isArray(list) ? list : []))
      .catch(() => setRawNodes([]))
      .finally(() => setNodesLoading(false))
  }, [])

  const installations = useMemo(() => {
    const seen = new Map()
    for (const n of rawNodes) {
      const id = n.portal_node_id
      if (id == null || seen.has(id)) continue
      seen.set(id, { id, name: n.portal_node_name || n.node })
    }
    return [...seen.values()]
  }, [rawNodes])

  useEffect(() => {
    setSelectedInstallation((prev) => (prev != null ? prev : installations[0]?.id ?? null))
  }, [installations])

  const tabCls = (active) =>
    `px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
      active
        ? 'border-portal-accent text-portal-accent'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('ha.title')}</h1>
          <HelpButton helpKey="ha" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 bg-transparent">
        {/* Installation selector (only with >1 installation) */}
        {installations.length > 1 && (
          <div className="flex items-center gap-3 flex-wrap mb-4">
            <label htmlFor="ha-install" className="text-xs font-medium text-gray-600 dark:text-zinc-400">
              {t('ha.installation')}
            </label>
            <select
              id="ha-install"
              value={selectedInstallation ?? ''}
              onChange={(e) => setSelectedInstallation(e.target.value ? Number(e.target.value) : null)}
              disabled={nodesLoading}
              className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent min-w-[180px]"
            >
              {installations.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <span className="text-[11px] text-gray-400 dark:text-zinc-500">{t('ha.installation_hint')}</span>
          </div>
        )}

        {/* Area tabs */}
        <div className="flex items-center border-b border-gray-200 dark:border-zinc-700 mb-5 overflow-x-auto overflow-y-hidden">
          <button onClick={() => setArea('status')} className={tabCls(area === 'status')}>{t('ha.tab_status')}</button>
          <button onClick={() => setArea('rules')} className={tabCls(area === 'rules')}>{t('ha.tab_rules')}</button>
          <button onClick={() => setArea('resources')} className={tabCls(area === 'resources')}>{t('ha.tab_resources')}</button>
        </div>

        {area === 'status' && (
          <HaStatusTab key={`s-${selectedInstallation ?? 'default'}`} portalNodeId={selectedInstallation} />
        )}
        {area === 'rules' && (
          <HaRulesSection key={`r-${selectedInstallation ?? 'default'}`} portalNodeId={selectedInstallation} canWrite={canWrite} />
        )}
        {area === 'resources' && (
          <HaResourcesSection key={`r-${selectedInstallation ?? 'default'}`} portalNodeId={selectedInstallation} canWrite={canWrite} />
        )}

        <Watermark />
      </main>
    </div>
  )
}
