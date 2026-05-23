// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getPlaybooks } from '../api/playbooks'

export function usePlaybooks() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['playbooks'],
    queryFn: getPlaybooks,
    staleTime: 60_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['playbooks'] })

  return {
    playbooks: data ?? [],
    loading: isLoading,
    error: error ?? null,
    reload,
  }
}
