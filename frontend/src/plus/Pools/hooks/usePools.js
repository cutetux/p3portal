// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-46: Data-Hook für Pools-Liste + Filter.
import { useState, useEffect, useCallback } from 'react'
import { poolsApi } from '../api'

export function usePools() {
  const [pools, setPools]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [filters, setFilters] = useState({ search: '', no_owner: false, tag: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (filters.search)   params.search   = filters.search
      if (filters.no_owner) params.no_owner = true
      if (filters.tag)      params.tag      = filters.tag
      const data = await poolsApi.list(params)
      setPools(data)
    } catch {
      setError('Pools konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  return { pools, loading, error, filters, setFilters, reload: load }
}

export function useTagsPool() {
  const [tags, setTags] = useState([])
  useEffect(() => {
    poolsApi.tagsPool().then(setTags).catch(() => {})
  }, [])
  return tags
}
