// p3portal.org
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getAuditLogs } from '../api/logs'

export function useAuditLogs({ eventType = '', username = '', limit = 100 } = {}) {
  const queryClient = useQueryClient()
  const [offset, setOffset] = useState(0)

  const { data, isLoading, error } = useQuery({
    queryKey: ['logs', { offset, limit, eventType, username }],
    queryFn: () => getAuditLogs({
      limit,
      offset,
      event_type: eventType || undefined,
      username: username || undefined,
    }),
    staleTime: 10_000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['logs'] })

  return {
    logs: data?.items ?? [],
    total: data?.total ?? 0,
    loading: isLoading,
    error: error ?? null,
    refresh,
    offset,
    setOffset,
    limit,
  }
}
