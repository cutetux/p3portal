// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPermissions } from '../api/auth'
import { fetchMyPermissions } from '../api/rbac'
import { useAuth } from './useAuth'

export function usePermissions() {
  const queryClient = useQueryClient()
  const { auth_type } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['permissions', auth_type],
    queryFn: async () => {
      const proxmoxPerms = await getPermissions()
      let rbacData = null
      if (auth_type === 'local') rbacData = await fetchMyPermissions()
      return { proxmoxPerms, rbacData }
    },
    staleTime: 120_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['permissions'] })

  return {
    proxmoxPerms: data?.proxmoxPerms ?? null,
    rbacData: data?.rbacData ?? null,
    loading: isLoading,
    error: error ?? null,
    reload,
  }
}
