// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchAnnouncements } from '../api/announcements'

export function useAnnouncements() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['announcements'],
    queryFn: fetchAnnouncements,
    staleTime: 60_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['announcements'] })

  return {
    announcements: data ?? [],
    loading: isLoading,
    error: error ?? null,
    reload,
  }
}
