// p3portal.org
/**
 * PROJ-42: IPAM-Panel – Sub-Tab-Container der IPAM-Area (Netzwerk-Seite).
 *
 * Phase 1 (Core): nur der „Pools"-Tab (IpamPoolsTab).
 * Phase 2 (Plus): zusätzlich „Allocations", „Netz-Freigaben" und „Einstellungen"
 * aus der Plus-Registry, gated `useCapability('ipam_plus')`. Reiner Core-Wrapper –
 * die Plus-Chunks werden erst geladen, wenn der jeweilige Sub-Tab gerendert wird
 * (Lazy). Sub-Tab-Zustand URL-basiert (`?ipamtab=`) für Pin-/Deep-Link-Fähigkeit.
 */
import { Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCapability } from '../../hooks/useCapability'
import { PlusComponents } from '../../plus'
import IpamPoolsTab from './IpamPoolsTab'

function subTabCls(active) {
  return `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
    active
      ? 'bg-portal-accent/15 text-portal-accent'
      : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
  }`
}

export default function IpamPanel() {
  const { t } = useTranslation()
  const hasIpamPlus = useCapability('ipam_plus')
  const AllocationsTab = PlusComponents.IpamAllocationsTab
  const NetworkGrantsTab = PlusComponents.IpamNetworkGrantsTab
  const SettingsSection = PlusComponents.IpamSettingsSection

  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('ipamtab')
  // Plus-Tabs nur zulassen, wenn lizenziert; sonst immer „pools".
  const validPlus = hasIpamPlus && ['allocations', 'grants', 'settings'].includes(requested)
  const sub = validPlus ? requested : 'pools'

  const setSub = (next) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('area', 'ipam')
      p.set('ipamtab', next)
      return p
    })
  }

  return (
    <div>
      {/* Sub-Tab-Leiste – nur zeigen, wenn es Plus-Tabs gibt (Core: nur Pools) */}
      {hasIpamPlus && (
        <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-zinc-700 pb-2">
          <button onClick={() => setSub('pools')} className={subTabCls(sub === 'pools')}>
            {t('ipam.subtab.pools')}
          </button>
          <button onClick={() => setSub('allocations')} className={subTabCls(sub === 'allocations')}>
            {t('ipam.subtab.allocations')}
          </button>
          <button onClick={() => setSub('grants')} className={subTabCls(sub === 'grants')}>
            {t('ipam.subtab.grants')}
          </button>
          <button onClick={() => setSub('settings')} className={subTabCls(sub === 'settings')}>
            {t('ipam.subtab.settings')}
          </button>
        </div>
      )}

      {sub === 'pools' && <IpamPoolsTab />}
      {sub === 'allocations' && hasIpamPlus && AllocationsTab && (
        <Suspense fallback={null}><AllocationsTab /></Suspense>
      )}
      {sub === 'grants' && hasIpamPlus && NetworkGrantsTab && (
        <Suspense fallback={null}><NetworkGrantsTab /></Suspense>
      )}
      {sub === 'settings' && hasIpamPlus && SettingsSection && (
        <Suspense fallback={null}><SettingsSection /></Suspense>
      )}
    </div>
  )
}
