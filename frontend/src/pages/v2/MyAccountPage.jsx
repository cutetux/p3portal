// p3portal.org
import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useCapability } from '../../hooks/useCapability'
import { getProfile } from '../../api/profile'
import { listMyApiKeys } from '../../api/userApiKeys'
import OverviewTab from '../../components/profile/OverviewTab'
import SecurityTab from '../../components/profile/SecurityTab'
import SshKeyTab from '../../components/profile/SshKeyTab'
import SessionsTab from '../../components/profile/SessionsTab'
import AppearanceTab from '../../components/profile/AppearanceTab'
import ApiKeysTab from '../../components/profile/ApiKeysTab'
import NotificationsTab from '../../components/profile/NotificationsTab'
import GroupsTab from '../../features/groups/components/GroupsTab'
import { PlusComponents } from '../../plus'
const PoolsTab = PlusComponents.PoolsTab
// PROJ-64: MyApprovalsTab nach plus/Approvals/ migriert – via Registry
const MyApprovalsTab = PlusComponents.MyApprovalsTab
import FavoritesPage from '../../features/sidebar_pins/Page'
import MyResourcesTab from '../../features/owners/MyResourcesTab'
import MyHelpOverridesTab from '../../features/help/components/MyHelpOverridesTab'
import HelpButton from '../../features/help/components/HelpButton'
import Watermark from '../../components/common/Watermark'

const TOP_TABS = [
  { id: 'konto',            label: 'Konto' },
  { id: 'einstellungen',    label: 'Einstellungen' },
  { id: 'zugriffe',         label: 'Zugriffe' },
  { id: 'mitgliedschaften', label: 'Mitgliedschaften' },
  { id: 'workflow',         label: 'Workflow' },
]

const SUB_TABS = {
  konto: [
    { id: 'profil',      label: 'Profil' },
    { id: 'sicherheit',  label: 'Sicherheit' },
    { id: 'sessions',    label: 'Sessions' },
  ],
  einstellungen: [
    { id: 'erscheinungsbild',    label: 'Erscheinungsbild' },
    { id: 'benachrichtigungen',  label: 'Benachrichtigungen' },
    { id: 'favoriten',           label: 'Favoriten' },
  ],
  mitgliedschaften: [
    { id: 'gruppen',    label: 'Gruppen' },
    { id: 'pools',      label: 'Pools' },
    { id: 'ressourcen', label: 'Meine Ressourcen' },
  ],
}

const SUB_DEFAULTS = {
  konto:            'profil',
  einstellungen:    'erscheinungsbild',
  zugriffe:         'ssh',
  mitgliedschaften: 'gruppen',
  workflow:         'antraege',
}

export default function MyAccountPage() {
  const { auth_type, updateToken } = useAuth()
  const isPlus = useCapability('api_key_max_count_override')
  const approvalWorkflow = useCapability('approval_workflow')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'konto'
  const activeSub = searchParams.get('sub') || SUB_DEFAULTS[activeTab] || 'profil'

  const [profile, setProfile] = useState(null)
  const [apiKeysEnabled, setApiKeysEnabled] = useState(false)

  useEffect(() => {
    getProfile().then(setProfile).catch(() => {})
    listMyApiKeys()
      .then(() => setApiKeysEnabled(true))
      .catch(() => setApiKeysEnabled(false))
  }, [])

  const myGroups = profile?.groups ?? []

  const setTopTab = (tab) => setSearchParams({ tab })
  const setSub = (sub) =>
    setSearchParams(prev => {
      const n = new URLSearchParams(prev)
      n.set('sub', sub)
      return n
    })

  const topTabCls = (id) =>
    `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === id
        ? 'border-portal-accent text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  const subTabCls = (id) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeSub === id
        ? 'border-portal-accent text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  const zugriffeSubs = [
    { id: 'ssh', label: 'SSH-Key' },
    ...(apiKeysEnabled ? [{ id: 'apikeys', label: 'API Keys' }] : []),
  ]

  const workflowSubs = [
    ...(approvalWorkflow ? [{ id: 'antraege', label: 'Meine Anträge' }] : []),
    { id: 'hilfetexte', label: 'Meine Hilfetexte' },
  ]

  const renderSubTabs = (subs) => (
    <div className="flex gap-1 border-b border-gray-200 dark:border-zinc-700">
      {subs.map(st => (
        <button key={st.id} onClick={() => setSub(st.id)} className={subTabCls(st.id)}>
          {st.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Mein Konto</h1>
          <HelpButton helpKey="account" />
        </div>
      </header>

      {/* Top-Tab-Leiste */}
      <div className="flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0 overflow-x-auto">
        {TOP_TABS.map(tab => (
          <button key={tab.id} onClick={() => setTopTab(tab.id)} className={topTabCls(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl space-y-4">

          {/* ── KONTO ── */}
          {activeTab === 'konto' && (
            <>
              {renderSubTabs(SUB_TABS.konto)}
              {activeSub === 'profil'     && <OverviewTab profile={profile} />}
              {activeSub === 'sicherheit' && <SecurityTab authType={auth_type} onPasswordChanged={updateToken} />}
              {activeSub === 'sessions'   && <SessionsTab />}
            </>
          )}

          {/* ── EINSTELLUNGEN ── */}
          {activeTab === 'einstellungen' && (
            <>
              {renderSubTabs(SUB_TABS.einstellungen)}
              {activeSub === 'erscheinungsbild'   && <AppearanceTab />}
              {activeSub === 'benachrichtigungen' && <NotificationsTab />}
              {activeSub === 'favoriten'          && <FavoritesPage />}
            </>
          )}

          {/* ── ZUGRIFFE ── */}
          {activeTab === 'zugriffe' && (
            <>
              {renderSubTabs(zugriffeSubs)}
              {activeSub === 'ssh'     && <SshKeyTab />}
              {activeSub === 'apikeys' && apiKeysEnabled && (
                <ApiKeysTab allowedScopes={null} maxKeys={isPlus ? null : 1} />
              )}
            </>
          )}

          {/* ── MITGLIEDSCHAFTEN ── */}
          {activeTab === 'mitgliedschaften' && (
            <>
              {renderSubTabs(SUB_TABS.mitgliedschaften)}
              {activeSub === 'gruppen'    && <GroupsTab groups={myGroups} />}
              {activeSub === 'pools'      && <Suspense fallback={null}><PoolsTab /></Suspense>}
              {activeSub === 'ressourcen' && <MyResourcesTab />}
            </>
          )}

          {/* ── WORKFLOW ── */}
          {activeTab === 'workflow' && (
            <>
              {renderSubTabs(workflowSubs)}
              {activeSub === 'antraege'   && approvalWorkflow && (
                <Suspense fallback={null}><MyApprovalsTab /></Suspense>
              )}
              {activeSub === 'hilfetexte' && <MyHelpOverridesTab />}
            </>
          )}

        </div>
        <Watermark />
      </div>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
