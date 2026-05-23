// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getLxcTemplates } from '../api/cluster'

export function useLxcTemplates() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['lxc-templates'],
    queryFn: getLxcTemplates,
    staleTime: 60_000,
  })

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['lxc-templates'] })

  return {
    available: data?.available ?? [],
    installed: data?.installed ?? [],
    failedNodes: data?.failed_nodes ?? [],
    isLoading: isLoading || isFetching,
    isError: !!error,
    errorMessage: error?.response?.data?.detail ?? error?.message ?? null,
    refetch,
  }
}
