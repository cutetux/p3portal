// p3portal.org
// PROJ-45: Data-Hook für Gruppen-Liste + Filter.
import { useState, useEffect, useCallback } from 'react'
import { groupsApi } from '../api'

export function useGroups() {
  const [groups, setGroups]   = useState([])
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
      const data = await groupsApi.list(params)
      setGroups(data)
    } catch {
      setError('Gruppen konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  return { groups, loading, error, filters, setFilters, reload: load }
}

export function useTagsPool() {
  const [tags, setTags] = useState([])
  useEffect(() => {
    groupsApi.tagsPool().then(setTags).catch(() => {})
  }, [])
  return tags
}
