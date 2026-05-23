// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getProxmoxAuditLog } from '../api/logs'

// tabVisible: false while loading or when PROXMOX_AUDIT_ENABLED is not set (404).
export function useProxmoxAuditLog() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['proxmox-audit'],
    queryFn: getProxmoxAuditLog,
    staleTime: 10_000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['proxmox-audit'] })

  const loading = isLoading || isFetching
  const is404 = error?.response?.status === 404
  const tabVisible = !loading && !is404

  return {
    entries: data ?? [],
    loading,
    error: is404 ? null : (error ?? null),
    tabVisible,
    refresh,
  }
}
