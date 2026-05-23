// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { getNodeBackups } from '../../api/cluster'

const STATUS_STYLE = {
  OK:      { dot: 'bg-green-500',  text: 'text-green-700 dark:text-green-400',  label: 'OK' },
  ok:      { dot: 'bg-green-500',  text: 'text-green-700 dark:text-green-400',  label: 'OK' },
  RUNNING: { dot: 'bg-orange-400', text: 'text-orange-700 dark:text-orange-400', label: 'Running' },
  running: { dot: 'bg-orange-400', text: 'text-orange-700 dark:text-orange-400', label: 'Running' },
  ERROR:   { dot: 'bg-red-500',    text: 'text-red-700 dark:text-red-400',       label: 'ERROR' },
  error:   { dot: 'bg-red-500',    text: 'text-red-700 dark:text-red-400',       label: 'ERROR' },
}

function getStatusStyle(status) {
  return STATUS_STYLE[status] ?? { dot: 'bg-gray-400', text: 'text-gray-500 dark:text-zinc-400', label: status }
}

function formatTs(ts) {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(seconds) {
  if (seconds == null) return '–'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function ComputeBackupsTab({ nodeName, active }) {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]    = useState(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    if (!active || !nodeName) return
    if (loadedFor.current === nodeName) return
    loadedFor.current = nodeName
    setLoading(true)
    setError(null)
    getNodeBackups(nodeName)
      .then(data => setBackups(data))
      .catch(err => setError(err?.response?.status === 403 ? '403' : 'Backup-Liste konnte nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [active, nodeName])

  useEffect(() => {
    loadedFor.current = null
    setBackups([])
    setError(null)
  }, [nodeName])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (error === '403') {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">Kein Zugriff</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Du hast keine Berechtigung, die Backups dieser Node zu sehen.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    )
  }

  if (backups.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">
        Keine Backups für diese Node gefunden
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">VMID</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Startzeit</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Dauer</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900">
          {backups.map(b => {
            const s = getStatusStyle(b.status)
            return (
              <tr key={b.upid} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
                <td className="px-4 py-2.5 text-xs font-mono text-gray-600 dark:text-zinc-300">{b.vmid ?? '–'}</td>
                <td className="px-4 py-2.5">
                  <span className={`flex items-center gap-1.5 text-xs ${s.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                    {s.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">{formatTs(b.starttime)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">{formatDuration(b.duration)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
