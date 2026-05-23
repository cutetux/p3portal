// p3portal.org
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { deletePackerIso } from '../../api/packer'
import { usePackerNodes } from '../../hooks/usePackerNodes'
import { useJobLog } from '../../hooks/useJobs'
import IsoDownloadModal from './IsoDownloadModal'

function formatBytes(bytes) {
  if (!bytes) return '–'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const STATUS_LABEL = { pending: 'Wartend', running: 'Läuft', success: 'Erfolgreich', failed: 'Fehlgeschlagen' }
const STATUS_COLOR = {
  pending: 'text-gray-500 dark:text-zinc-400',
  running: 'text-orange-500',
  success: 'text-green-500',
  failed: 'text-red-500',
}

function InlineJobLog({ jobId }) {
  const navigate = useNavigate()
  const { lines, status, connected } = useJobLog(jobId)

  return (
    <div className="border border-gray-200 dark:border-zinc-700">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium flex items-center gap-1 ${STATUS_COLOR[status] ?? 'text-gray-500'}`}>
            {status === 'running' && (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            Download-Job: {STATUS_LABEL[status] ?? status}
          </span>
          <span className={`text-xs ${connected ? 'text-green-500' : 'text-gray-400 dark:text-zinc-600'}`}>
            {connected ? '● Live' : '○ Getrennt'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/events/${jobId}`)}
          className="text-xs text-orange-600 dark:text-orange-400 hover:underline shrink-0"
        >
          Job anzeigen →
        </button>
      </div>
      <div className="h-44 overflow-y-auto bg-slate-950 p-3 font-mono text-xs text-slate-300 leading-relaxed">
        {lines.length === 0 ? (
          <span className="text-slate-600">Warte auf Output…</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))
        )}
      </div>
    </div>
  )
}

export default function IsoManagerTab() {
  const {
    nodes, isos,
    nodesLoading, isosLoading,
    nodesError, isosError,
    fetchNodes, fetchIsos,
    queryUrl, startDownload,
  } = usePackerNodes()

  const [selectedNode, setSelectedNode] = useState('')
  const [deletingVolid, setDeletingVolid] = useState(null)
  const [deleteInProgress, setDeleteInProgress] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadJob, setDownloadJob] = useState(null)

  const inputBase =
    'border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition'

  useEffect(() => {
    fetchNodes()
  }, [fetchNodes])

  // Auto-select single node (Core edition)
  useEffect(() => {
    if (nodesLoading || nodesError || nodes.length !== 1) return
    if (selectedNode === nodes[0].name) return
    handleNodeChange(nodes[0].name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, nodesLoading, nodesError])

  const handleNodeChange = (node) => {
    setSelectedNode(node)
    setDeleteError(null)
    setDeletingVolid(null)
    setDownloadJob(null)
    if (node) fetchIsos(node)
  }

  const handleRefresh = () => {
    if (selectedNode) fetchIsos(selectedNode)
  }

  const handleDeleteClick = async (volid) => {
    if (deletingVolid !== volid) {
      setDeletingVolid(volid)
      setDeleteError(null)
      return
    }
    setDeleteInProgress(volid)
    setDeleteError(null)
    try {
      await deletePackerIso(selectedNode, volid)
      setDeletingVolid(null)
      fetchIsos(selectedNode)
    } catch (err) {
      setDeleteError(err.response?.data?.detail ?? 'Löschen fehlgeschlagen.')
      setDeletingVolid(null)
    } finally {
      setDeleteInProgress(null)
    }
  }

  const handleDownloadStarted = (job) => {
    setDownloadJob(job)
    setShowDownloadModal(false)
  }

  const handleUseExisting = () => {
    fetchIsos(selectedNode)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-3xl space-y-5">

        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">Proxmox ISO-Verwaltung</h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            ISOs auf dem Proxmox-Node verwalten und herunterladen
          </p>
        </div>

        {/* Node selector */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
            Proxmox Node
          </label>
          <select
            value={selectedNode}
            onChange={e => handleNodeChange(e.target.value)}
            disabled={nodesLoading}
            className={`${inputBase} w-full max-w-xs`}
          >
            <option value="">{nodesLoading ? 'Lädt…' : '– Node auswählen –'}</option>
            {nodes.map(n => (
              <option key={n.name} value={n.name} disabled={n.status !== 'online'}>
                {n.name}{n.status !== 'online' ? ` (${n.status})` : ''}
              </option>
            ))}
          </select>
          {nodesError && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Node-Liste nicht verfügbar.
            </p>
          )}
        </div>

        {/* ISO management area */}
        {selectedNode ? (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                ISOs auf{' '}
                <span className="font-mono text-orange-600 dark:text-orange-400">{selectedNode}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isosLoading}
                  className="p-1 text-gray-400 dark:text-zinc-500 hover:text-orange-500 dark:hover:text-orange-400 transition-colors disabled:opacity-50"
                  title="Aktualisieren"
                >
                  {isosLoading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDownloadModal(true)}
                  className="btn-primary flex items-center gap-1.5 text-xs"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  ISO herunterladen
                </button>
              </div>
            </div>

            {deleteError && (
              <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                {deleteError}
              </div>
            )}

            {/* ISO list */}
            {isosError ? (
              <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                ISO-Liste nicht verfügbar: {isosError.response?.data?.detail ?? isosError.message ?? isosError}
              </div>
            ) : isosLoading ? (
              <div className="space-y-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 bg-gray-100 dark:bg-zinc-800 animate-pulse" />
                ))}
              </div>
            ) : isos.length === 0 ? (
              <div className="border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-10 text-center">
                <p className="text-sm text-gray-500 dark:text-zinc-400">Keine ISOs vorhanden.</p>
                <button
                  type="button"
                  onClick={() => setShowDownloadModal(true)}
                  className="mt-2 text-xs text-orange-600 dark:text-orange-400 hover:underline"
                >
                  ISO herunterladen
                </button>
              </div>
            ) : (
              <div className="border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800 rounded-lg overflow-hidden">
                {isos.map(iso => (
                  <div key={iso.volid} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">{iso.filename}</p>
                      <p className="text-xs text-gray-400 dark:text-zinc-500 font-mono truncate">
                        {formatBytes(iso.size)} · {iso.volid}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {deletingVolid === iso.volid ? (
                        <>
                          <span className="text-xs text-red-600 dark:text-red-400">Wirklich löschen?</span>
                          <button
                            onClick={() => handleDeleteClick(iso.volid)}
                            disabled={deleteInProgress === iso.volid}
                            className="text-xs bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-2 py-1 transition-colors"
                          >
                            {deleteInProgress === iso.volid ? 'Löscht…' : 'Ja, löschen'}
                          </button>
                          <button
                            onClick={() => setDeletingVolid(null)}
                            className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
                          >
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleDeleteClick(iso.volid)}
                          disabled={deleteInProgress !== null}
                          className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 transition-colors"
                        >
                          Löschen
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Inline job log for active download */}
            {downloadJob && (
              <InlineJobLog jobId={downloadJob.id} />
            )}
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-sm text-gray-400 dark:text-zinc-500">
              Node auswählen um ISOs zu verwalten.
            </p>
          </div>
        )}
      </div>

      {showDownloadModal && selectedNode && (
        <IsoDownloadModal
          node={selectedNode}
          onClose={() => setShowDownloadModal(false)}
          onDownloadStarted={handleDownloadStarted}
          onUseExisting={handleUseExisting}
          queryUrl={queryUrl}
          startDownload={startDownload}
        />
      )}
    </div>
  )
}
