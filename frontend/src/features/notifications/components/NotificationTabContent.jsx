// p3portal.org
// PROJ-65: Tab-Inhalt der Hub-Seite mit Items + Detail-Modals
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import NotificationItemRow from './NotificationItemRow'
import AnnouncementDetailModalSlim from './AnnouncementDetailModalSlim'
import ClusterTaskDetailModalSlim from './ClusterTaskDetailModalSlim'
import AuditDetailModalSlim from './AuditDetailModalSlim'

const EMPTY_KEYS = {
  alerts: 'notifications.tab_empty_alerts',
  announcements: 'notifications.tab_empty_announcements',
  events: 'notifications.tab_empty_events',
}

function getModal(item) {
  if (!item) return null
  if (item.source === 'announcement') return 'announcement'
  if (item.source === 'event') {
    const sub = item.meta?.type ?? ''
    if (sub === 'cluster_task') return 'cluster_task'
    if (sub === 'audit') return 'audit'
    // job → link navigation
    return null
  }
  return null
}

export default function NotificationTabContent({ tab, items = [], isLoading, highlightId }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [modalItem, setModalItem] = useState(null)
  const highlightRef = useRef(null)

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, items.length])

  const handleItemClick = (item) => {
    const modalType = getModal(item)
    if (modalType) {
      setModalItem(item)
    } else if (item.link?.route) {
      navigate(item.link.route)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-1 px-2 py-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-12 bg-portal-bg3/40 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-portal-text3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mb-3 opacity-40">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <p className="text-sm">{t(EMPTY_KEYS[tab] ?? 'notifications.tab_empty_generic')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-0.5 py-1">
        {items.map(item => (
          <div
            key={item.source_id}
            ref={item.source_id === highlightId ? highlightRef : null}
          >
            <NotificationItemRow
              item={item}
              isHighlighted={item.source_id === highlightId}
              onClick={() => handleItemClick(item)}
            />
          </div>
        ))}
      </div>

      {/* Detail Modals */}
      {modalItem?.source === 'announcement' && (
        <AnnouncementDetailModalSlim item={modalItem} onClose={() => setModalItem(null)} />
      )}
      {modalItem?.source === 'event' && modalItem.meta?.type === 'cluster_task' && (
        <ClusterTaskDetailModalSlim item={modalItem} onClose={() => setModalItem(null)} />
      )}
      {modalItem?.source === 'event' && modalItem.meta?.type === 'audit' && (
        <AuditDetailModalSlim item={modalItem} onClose={() => setModalItem(null)} />
      )}
    </>
  )
}
