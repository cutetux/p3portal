// p3portal.org
// PROJ-54: Data-Hook für die eigene Sidebar-Pins-Liste.
// Nutzt React Query damit Pins nach Toggle sofort in der Sidebar erscheinen.
import { useQuery } from '@tanstack/react-query'
import { sidebarPinsApi } from '../api'

export function useSidebarPins() {
  const { data: pins = [], isLoading: loading, error: rawError, refetch } = useQuery({
    queryKey: ['sidebar-pins'],
    queryFn: () => sidebarPinsApi.list(),
    staleTime: 30_000,
  })
  const error = rawError ? 'Favoriten konnten nicht geladen werden.' : ''
  return { pins, loading, error, reload: refetch }
}
