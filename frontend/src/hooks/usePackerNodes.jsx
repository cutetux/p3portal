// p3portal.org
import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPackerNodes, getPackerIsos, getPackerStorages, queryIsoUrl, downloadIso } from '../api/packer'

export function usePackerNodes() {
  // nodes: cached via React Query (enabled: false → imperative fetchNodes triggers it)
  const { data: nodes = [], isFetching: nodesLoading, error: nodesError, refetch } = useQuery({
    queryKey: ['packer', 'nodes'],
    queryFn: getPackerNodes,
    enabled: false,
    staleTime: 60_000,
  })

  const fetchNodes = useCallback(async () => {
    const result = await refetch()
    return result.data ?? []
  }, [refetch])

  // isos/storages remain imperative (node-dependent, user-triggered)
  const [isos, setIsos] = useState([])
  const [storages, setStorages] = useState([])
  const [isosLoading, setIsosLoading] = useState(false)
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [isosError, setIsosError] = useState(null)
  const [storagesError, setStoragesError] = useState(null)

  const fetchIsos = useCallback(async (node) => {
    if (!node) { setIsos([]); return [] }
    setIsosLoading(true)
    setIsosError(null)
    try {
      const data = await getPackerIsos(node)
      setIsos(data)
      return data
    } catch (err) {
      setIsosError(err)
      return []
    } finally {
      setIsosLoading(false)
    }
  }, [])

  const fetchStorages = useCallback(async (node) => {
    if (!node) { setStorages([]); return [] }
    setStoragesLoading(true)
    setStoragesError(null)
    try {
      const data = await getPackerStorages(node)
      setStorages(data)
      return data
    } catch (err) {
      setStoragesError(err)
      return []
    } finally {
      setStoragesLoading(false)
    }
  }, [])

  const queryUrl = useCallback((url) => queryIsoUrl(url), [])
  const startDownload = useCallback((payload) => downloadIso(payload), [])

  return {
    nodes,
    isos,
    storages,
    nodesLoading,
    isosLoading,
    storagesLoading,
    nodesError: nodesError ?? null,
    isosError,
    storagesError,
    fetchNodes,
    fetchIsos,
    fetchStorages,
    queryUrl,
    startDownload,
  }
}
