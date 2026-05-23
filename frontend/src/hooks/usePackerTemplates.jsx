// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPackerTemplates } from '../api/packer'
import { getJobs } from '../api/jobs'

export function usePackerTemplates() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['packer', 'templates'],
    queryFn: async () => {
      const [tmpl, jobs] = await Promise.all([fetchPackerTemplates(), getJobs()])
      return {
        templates: tmpl,
        runningBuilds: new Set(
          jobs.filter(j => j.type === 'packer' && j.status === 'running').map(j => j.playbook)
        ),
      }
    },
    staleTime: 60_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['packer', 'templates'] })

  return {
    templates: data?.templates ?? [],
    runningBuilds: data?.runningBuilds ?? new Set(),
    loading: isLoading,
    error: error ?? null,
    reload,
  }
}
