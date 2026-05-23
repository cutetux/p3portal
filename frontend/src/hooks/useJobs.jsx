// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getJobs, getJob, createJobLogSocket } from '../api/jobs'

export function useJobs() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['jobs'],
    queryFn: getJobs,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['jobs'] })

  return {
    jobs: data ?? [],
    loading: isLoading,
    error: error ?? null,
    refresh,
  }
}

export function useJobLog(jobId) {
  const [lines, setLines] = useState([])
  const [status, setStatus] = useState('pending')
  const [connected, setConnected] = useState(false)
  const [job, setJob] = useState(null)
  const wsRef = useRef(null)

  useEffect(() => {
    if (!jobId) return

    setJob(null)
    getJob(jobId).then(j => {
      setStatus(j.status)
      setJob(j)
    }).catch(() => {})

    const ws = createJobLogSocket(jobId)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onmessage = (e) => {
      const text = e.data
      if (text.startsWith('[status] ')) {
        setStatus(text.slice('[status] '.length).trim())
      } else {
        setLines(l => [...l, text])
      }
    }
    ws.onerror = () => setConnected(false)
    ws.onclose = () => setConnected(false)

    return () => ws.close()
  }, [jobId])

  return { lines, status, connected, job }
}
