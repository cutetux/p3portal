// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getLanguages } from '../api/translations'

const BUILTIN_LANGUAGES = [
  { code: 'de', name: 'Deutsch', is_builtin: true },
  { code: 'en', name: 'English', is_builtin: true },
]

export function useLanguages() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['languages'],
    queryFn: async () => {
      try { return await getLanguages() }
      catch { return BUILTIN_LANGUAGES }
    },
    staleTime: 300_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['languages'] })

  return {
    languages: data ?? BUILTIN_LANGUAGES,
    loading: isLoading || isFetching,
    reload,
  }
}
