// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getThemes } from '../api/themes'
import { BUILTIN_THEMES } from './useTheme'

export function useThemes() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['themes'],
    queryFn: async () => {
      try { return await getThemes() }
      catch { return BUILTIN_THEMES }
    },
    staleTime: 300_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['themes'] })

  return {
    themes: data ?? BUILTIN_THEMES,
    loading: isLoading || isFetching,
    error: error ?? null,
    reload,
  }
}
