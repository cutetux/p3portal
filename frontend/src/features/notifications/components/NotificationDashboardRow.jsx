// p3portal.org
// PROJ-65: 3-Spalten Dashboard-Widget-Reihe (über Nodes-Sektion)
import NotificationWidget from './NotificationWidget'

export default function NotificationDashboardRow() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <NotificationWidget source="alert" />
      <NotificationWidget source="announcement" />
      <NotificationWidget source="event" />
    </div>
  )
}
