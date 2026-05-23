// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useClusterData } from '../hooks/useClusterData'
import { useAuth } from '../hooks/useAuth'
import ClusterHealthBanner from '../components/dashboard/ClusterHealthBanner'
import AnnouncementsBanner from '../components/dashboard/AnnouncementsBanner'
import AlertsBanner from '../components/dashboard/AlertsBanner'
import NodeSection from '../components/dashboard/NodeSection'
import VmSection from '../components/dashboard/VmSection'
import TokenMissingBanner from '../components/ui/TokenMissingBanner'
import HelpButton from '../features/help/components/HelpButton'
import NotificationDashboardRow from '../features/notifications/components/NotificationDashboardRow'
import Watermark from '../components/common/Watermark'

function LastUpdated({ date, onRefresh, loading }) {
  const { t, i18n } = useTranslation()
  if (!date && !loading) return null
  const locale = i18n.language === 'en' ? 'en-GB' : 'de-DE'
  return (
    <div className="flex items-center gap-3 text-xs dark:text-zinc-500 text-gray-500">
      {date && <span>{t('dashboard.last_updated', { time: date.toLocaleTimeString(locale) })}</span>}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="text-orange-500 hover:underline disabled:opacity-40 transition-colors"
      >
        {loading ? t('dashboard.refreshing') : t('dashboard.refresh')}
      </button>
    </div>
  )
}

function ErrorBanner({ error, isLocalUser }) {
  const { t } = useTranslation()
  const status = error?.response?.status

  if (status === 503 && isLocalUser) {
    // Fehlender Service-Account – gezielt anzeigen
    return null
  }

  const msg =
    status === 503
      ? t('dashboard.err_503')
      : status === 401
      ? t('dashboard.err_401')
      : t('dashboard.err_default')

  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      {t('dashboard.err_prefix')}{msg}
    </div>
  )
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { nodes, vms, clusterStatus, loading, refreshing, error, lastUpdated, refresh } = useClusterData()
  const { role, auth_type } = useAuth()

  const isLocalUser = auth_type === 'local'
  const is503 = error?.response?.status === 503

  const [selectedNode, setSelectedNode] = useState(null)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('dashboard.title')}</h1>
          <HelpButton helpKey="dashboard" />
        </div>
        <LastUpdated date={lastUpdated} onRefresh={refresh} loading={loading || refreshing} />
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-transparent">
        {error && is503 && isLocalUser
          ? <TokenMissingBanner role={role} />
          : error && <ErrorBanner error={error} isLocalUser={isLocalUser} />
        }
        <AnnouncementsBanner />
        <AlertsBanner />
        <ClusterHealthBanner status={clusterStatus} unreachable_nodes={clusterStatus?.unreachable_nodes ?? []} />
        <NotificationDashboardRow />
        <NodeSection nodes={nodes} loading={loading} selectedNode={selectedNode} onNodeSelect={setSelectedNode} />
        <VmSection vms={vms} loading={loading} userRole={role} onRefresh={refresh} selectedNode={selectedNode} onNodeSelect={setSelectedNode} />
        <Watermark />
      </main>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
