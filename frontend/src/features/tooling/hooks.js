// p3portal.org
// PROJ-66: Tooling-Health React Query Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchToolingStatus, postToolingRecheck, fetchToolingAuditHistory } from './api'

const STALE = 720_000
const POLL  = 720_000

// AC-POLL-1: staleTime + refetchInterval + refetchOnWindowFocus
export function useToolingStatus() {
  return useQuery({
    queryKey: ['tooling', 'status'],
    queryFn: fetchToolingStatus,
    staleTime: STALE,
    refetchInterval: POLL,
    refetchOnWindowFocus: true,
  })
}

export function useToolingAuditHistory(tool) {
  return useQuery({
    queryKey: ['tooling', 'audit-history', tool],
    queryFn: () => fetchToolingAuditHistory(tool, 20),
    staleTime: 60_000,
    enabled: !!tool,
  })
}

// AC-SLIDE-4: nach erfolgreichem Recheck Cache invalidieren
export function useToolingRecheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: postToolingRecheck,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tooling'] })
    },
  })
}
