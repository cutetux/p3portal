// p3portal.org
// PROJ-47: Hooks für Node-Assignments.
import { useState, useEffect, useCallback } from 'react'
import { nodeAssignmentsApi, myNodeAssignmentsApi } from '../api'

export function useNodeAssignments(nodeId) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')

  const load = useCallback(async () => {
    if (!nodeId) return
    setError('')
    try {
      const data = await nodeAssignmentsApi.list(nodeId)
      setAssignments(data)
    } catch {
      setError('Zuweisungen konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [nodeId])

  useEffect(() => { load() }, [load])

  return { assignments, loading, error, reload: load }
}

export function useMyNodeAssignments() {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    myNodeAssignmentsApi.list()
      .then(setAssignments)
      .catch(() => setAssignments([]))
      .finally(() => setLoading(false))
  }, [])

  return { assignments, loading }
}
