// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listScheduledJobs, getScheduledJobRuns } from '../api/scheduledJobs'

export function useScheduledJobs() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['scheduled-jobs'],
    queryFn: listScheduledJobs,
    staleTime: 30_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['scheduled-jobs'] })

  return {
    jobs: data ?? [],
    loading: isLoading || isFetching,
    error: error ?? null,
    reload,
  }
}

export function useScheduledJobRuns(jobId) {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['scheduled-job-runs', jobId],
    queryFn: () => getScheduledJobRuns(jobId),
    enabled: !!jobId,
    staleTime: 30_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['scheduled-job-runs', jobId] })

  return {
    runs: data ?? [],
    loading: isLoading || isFetching,
    error: error ?? null,
    reload,
  }
}
