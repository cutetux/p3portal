// p3portal.org
// PROJ-54: Data-Hook für die eigene Sidebar-Pins-Liste.
// Nutzt React Query damit Pins nach Toggle sofort in der Sidebar erscheinen.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sidebarPinsApi } from '../api'

export function useSidebarPins() {
  const qc = useQueryClient()
  const { data: pins = [], isLoading: loading, error: rawError, refetch } = useQuery({
    queryKey: ['sidebar-pins'],
    queryFn: () => sidebarPinsApi.list(),
    staleTime: 30_000,
  })
  const error = rawError ? 'Favoriten konnten nicht geladen werden.' : ''
  // Writes through to the React Query cache so the sidebar (same key) stays
  // in sync. Accepts a value or an updater fn (both supported by setQueryData).
  const setPins = (next) => qc.setQueryData(['sidebar-pins'], next)
  return { pins, setPins, loading, error, reload: refetch }
}
