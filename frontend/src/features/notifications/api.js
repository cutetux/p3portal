// p3portal.org
// PROJ-65: Notification Hub API-Client
import api from '../../api/client'

export async function fetchNotificationSummary() {
  const { data } = await api.get('/api/notifications/unread-summary')
  return data
}

export async function fetchNotificationTab(tab, limit = 200) {
  const { data } = await api.get('/api/notifications', { params: { tab, limit } })
  return data
}

export async function markNotificationsRead(source, sourceIds) {
  if (!sourceIds || sourceIds.length === 0) return { marked: 0 }
  const { data } = await api.post('/api/notifications/read', {
    source,
    source_ids: sourceIds.slice(0, 200),
  })
  return data
}
