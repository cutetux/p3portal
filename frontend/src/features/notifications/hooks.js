// p3portal.org
// PROJ-65: Notification Hub Hooks (React Query)
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchNotificationSummary,
  fetchNotificationTab,
  markNotificationsRead,
} from './api'

const STALE = 30_000
const POLL = 30_000

export function useNotificationSummary() {
  return useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: fetchNotificationSummary,
    staleTime: STALE,
    refetchInterval: POLL,
    refetchOnWindowFocus: true,
  })
}

export function useNotificationTab(tab, enabled = true) {
  return useQuery({
    queryKey: ['notifications', 'tab', tab],
    queryFn: () => fetchNotificationTab(tab, 200),
    staleTime: STALE,
    refetchInterval: POLL,
    refetchOnWindowFocus: true,
    enabled,
  })
}

export function useNotificationWidget(source) {
  return useQuery({
    queryKey: ['notifications', 'widget', source],
    queryFn: () => fetchNotificationTab(
      source === 'alert' ? 'alerts'
        : source === 'announcement' ? 'announcements'
        : 'events',
      3,
    ),
    staleTime: STALE,
    refetchInterval: POLL,
    refetchOnWindowFocus: true,
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ source, sourceIds }) => markNotificationsRead(source, sourceIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
