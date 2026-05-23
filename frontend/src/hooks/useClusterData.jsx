// p3portal.org
import { useState, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getNodes, getVms, getClusterStatus } from '../api/cluster'

const STALE_TIME = 15_000
const REFETCH_INTERVAL = 30_000

export function useClusterData() {
  // forceRef communicates to queryFns whether this is a manual force-refresh
  // (bypasses the backend's ClusterCacheService, PROJ-33)
  const forceRef = useRef(false)
  const [refreshing, setRefreshing] = useState(false)

  const nodesQuery = useQuery({
    queryKey: ['cluster', 'nodes'],
    queryFn: () => getNodes(forceRef.current),
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  })
  const vmsQuery = useQuery({
    queryKey: ['cluster', 'vms'],
    queryFn: () => getVms(forceRef.current),
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  })
  const statusQuery = useQuery({
    queryKey: ['cluster', 'status'],
    queryFn: () => getClusterStatus(forceRef.current),
    staleTime: STALE_TIME,
    refetchInterval: REFETCH_INTERVAL,
  })

  const { refetch: refetchNodes } = nodesQuery
  const { refetch: refetchVms }   = vmsQuery
  const { refetch: refetchStatus } = statusQuery

  const refresh = useCallback(async () => {
    forceRef.current = true
    setRefreshing(true)
    await Promise.all([refetchNodes(), refetchVms(), refetchStatus()])
    forceRef.current = false
    setRefreshing(false)
  }, [refetchNodes, refetchVms, refetchStatus])

  const loading = nodesQuery.isLoading || vmsQuery.isLoading || statusQuery.isLoading
  const error = nodesQuery.error || vmsQuery.error || statusQuery.error || null
  const lastUpdated = (!loading && !error)
    ? new Date(Math.max(nodesQuery.dataUpdatedAt ?? 0, vmsQuery.dataUpdatedAt ?? 0, statusQuery.dataUpdatedAt ?? 0))
    : null

  return {
    nodes: nodesQuery.data ?? [],
    vms: vmsQuery.data ?? [],
    clusterStatus: statusQuery.data ?? null,
    loading,
    refreshing,
    error,
    lastUpdated,
    refresh,
  }
}
