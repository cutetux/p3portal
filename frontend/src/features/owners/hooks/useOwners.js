// p3portal.org
// PROJ-48: React-Query-Hooks für Owner-Daten.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ownersApi } from '../api'

// Owner-Liste für eine einzelne Ressource
export function useOwnersForResource(resourceType, nodeId, vmid) {
  return useQuery({
    queryKey: ['owners', resourceType, nodeId, vmid],
    queryFn: () => ownersApi.listForResource(resourceType, nodeId, vmid),
    staleTime: 30_000,
    enabled: !!(resourceType && nodeId && vmid),
  })
}

// Eigene Owner-Einträge (Meine Ressourcen)
export function useMyOwners() {
  return useQuery({
    queryKey: ['owners', 'me'],
    queryFn: () => ownersApi.listMine(),
    staleTime: 30_000,
  })
}

// Bulk-Lookup für mehrere Ressourcen (Dashboard VM-Tabelle)
export function useBulkOwners(resources) {
  return useQuery({
    queryKey: ['owners', 'bulk', resources],
    queryFn: () => ownersApi.bulk(resources),
    staleTime: 30_000,
    enabled: Array.isArray(resources) && resources.length > 0,
  })
}

// Owner-Konfig (enabled + categories)
export function useOwnerConfig() {
  return useQuery({
    queryKey: ['owners', 'config'],
    queryFn: () => ownersApi.getConfig(),
    staleTime: 60_000,
  })
}

// Invalidierungs-Helper für Owner-Queries nach Mutationen
export function useInvalidateOwners() {
  const queryClient = useQueryClient()
  return (resourceType, nodeId, vmid) => {
    queryClient.invalidateQueries({ queryKey: ['owners', resourceType, nodeId, vmid] })
    queryClient.invalidateQueries({ queryKey: ['owners', 'me'] })
    queryClient.invalidateQueries({ queryKey: ['owners', 'bulk'] })
    queryClient.invalidateQueries({ queryKey: ['license'] })
  }
}
