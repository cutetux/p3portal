// p3portal.org
// PROJ-65: NotificationsHubPage – kombinierte Benachrichtigungs-Seite (/announcements)
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotificationTab } from './hooks'
import NotificationTabContent from './components/NotificationTabContent'
import MarkAllReadButton from './components/MarkAllReadButton'
import { usePinToggle } from '../sidebar_pins/hooks/usePinToggle'
import PinIcon from '../../components/common/PinIcon'

const TABS = ['announcements', 'alerts', 'events']
const TAB_SOURCE = { announcements: 'announcement', alerts: 'alert', events: 'event' }
const TAB_LABEL_KEYS = {
  announcements: 'notifications.tab_announcements',
  alerts: 'notifications.tab_alerts',
  events: 'notifications.tab_events',
}

function tabCls(active) {
  return `px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
    active
      ? 'border-portal-accent text-portal-accent'
      : 'border-transparent text-portal-text2 hover:text-portal-text hover:border-portal-border'
  }`
}

function TabPanel({ tab, highlightId }) {
  const { data: items = [], isLoading } = useNotificationTab(tab)

  // Kein automatisches Bulk-Mark beim Tab-Besuch: ungelesene Einträge bleiben
  // sichtbar „neu". Markiert wird einzeln beim Öffnen (NotificationItemRow)
  // oder gesammelt über den „Alle als gelesen markieren"-Button.
  return (
    <NotificationTabContent
      tab={tab}
      items={items}
      isLoading={isLoading}
      highlightId={highlightId}
    />
  )
}

export default function NotificationsHubPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const activeTab = TABS.includes(params.get('tab')) ? params.get('tab') : 'announcements'
  const highlightId = params.get('item') ?? null
  const [highlightedItem, setHighlightedItem] = useState(highlightId)

  // Highlight-Fade: nach 1000 ms zurücksetzen
  useEffect(() => {
    if (highlightId) {
      setHighlightedItem(highlightId)
      const timer = setTimeout(() => setHighlightedItem(null), 1000)
      return () => clearTimeout(timer)
    } else {
      setHighlightedItem(null)
    }
  }, [highlightId])

  const { data: items = [] } = useNotificationTab(activeTab)
  const source = TAB_SOURCE[activeTab]

  const setTab = (tab) => setParams(prev => {
    prev.set('tab', tab)
    prev.delete('item')
    return prev
  })

  const { isPinned, loading: pinLoading, toggle: togglePin, atLimit } = usePinToggle({
    route: '/announcements',
    pinKind: 'other',
    defaultLabel: t('notifications.page_title'),
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page Header */}
      <header className="h-12 flex items-center justify-between px-6 border-b border-portal-border bg-portal-card shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-portal-text">{t('notifications.page_title')}</h1>
          <button
            onClick={togglePin}
            disabled={pinLoading || (atLimit && !isPinned)}
            className="p-0.5 rounded transition-colors hover:bg-portal-bg3 disabled:opacity-40 disabled:cursor-not-allowed"
            title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
          >
            <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <div className="max-w-3xl w-full mx-auto px-4 py-4 flex flex-col flex-1 min-h-0">
          {/* Tab Bar + Toolbar */}
          <div className="flex items-center justify-between border-b border-portal-border mb-2 gap-4 flex-wrap">
            <div className="flex">
              {TABS.map(tab => (
                <button
                  key={tab}
                  onClick={() => setTab(tab)}
                  className={tabCls(activeTab === tab)}
                >
                  {t(TAB_LABEL_KEYS[tab])}
                </button>
              ))}
            </div>
            <MarkAllReadButton source={source} items={items} />
          </div>

          {/* Tab-Content */}
          <TabPanel tab={activeTab} highlightId={highlightedItem} />
        </div>
      </div>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
