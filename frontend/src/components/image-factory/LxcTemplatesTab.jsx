// p3portal.org
import { useState } from 'react'
import { useLxcTemplates } from '../../hooks/useLxcTemplates'
import { useAuth } from '../../hooks/useAuth'
import { deleteLxcTemplate, getPortalNodes } from '../../api/cluster'
import LxcDownloadModal from './LxcDownloadModal'
import LxcUploadModal from './LxcUploadModal'
import ConfirmModal from '../common/ConfirmModal'

function Section({ children }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <div className="divide-y divide-gray-100 dark:divide-zinc-800">{children}</div>
    </div>
  )
}

function FailedNodesBanner({ nodes }) {
  if (!nodes || nodes.length === 0) return null
  return (
    <div className="flex items-start gap-3 border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-950/40 px-4 py-3 rounded-lg text-sm text-yellow-800 dark:text-yellow-300">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 mt-0.5 shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>
        Folgende Nodes nicht erreichbar: <span className="font-mono font-medium">{nodes.join(', ')}</span>. Template-Daten möglicherweise unvollständig.
      </span>
    </div>
  )
}

function DownloadableRow({ tmpl, canOperator, onOpenDownload }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 dark:text-zinc-100 truncate">{tmpl.title ?? tmpl.template}</p>
        <p className="text-xs text-gray-400 dark:text-zinc-500 font-mono truncate">{tmpl.template}</p>
        {tmpl.description && (
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5 line-clamp-1">{tmpl.description}</p>
        )}
      </div>
      {tmpl.size && (
        <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">
          {(tmpl.size / (1024 * 1024)).toFixed(0)} MB
        </span>
      )}
      {canOperator && (
        <button
          onClick={() => onOpenDownload(tmpl)}
          className="btn-primary shrink-0 text-xs px-3 py-1.5"
        >
          Download
        </button>
      )}
    </div>
  )
}

function InstalledRow({ tmpl, canAdmin, onRequestDelete, deleting }) {
  const isMe = deleting === tmpl.volid

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900 dark:text-zinc-100 truncate">{tmpl.volid}</p>
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          Node: <span className="font-mono">{tmpl.portal_node_name ?? tmpl.node}</span>
          {tmpl.storage && ` · ${tmpl.storage}`}
          {tmpl.size && ` · ${(tmpl.size / (1024 * 1024)).toFixed(0)} MB`}
        </p>
      </div>
      {canAdmin && (
        <button
          onClick={() => onRequestDelete(tmpl)}
          disabled={isMe}
          className="btn-table-danger shrink-0"
        >
          {isMe ? '…' : 'Löschen'}
        </button>
      )}
    </div>
  )
}

export default function LxcTemplatesTab() {
  const { role } = useAuth()
  const canAdmin = role === 'admin'
  const canOperator = role === 'admin' || role === 'operator'

  const { available, installed, failedNodes, isLoading, isError, errorMessage, refetch } = useLxcTemplates()

  const [deleting, setDeleting] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [msg, setMsg] = useState(null)
  const [nodeFilter, setNodeFilter] = useState('ALL')
  const [availableSearch, setAvailableSearch] = useState('')
  const [downloadTemplate, setDownloadTemplate] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [portalNodes, setPortalNodes] = useState(null)

  const nodes = [...new Set(installed.map(t => t.portal_node_name ?? t.node).filter(Boolean))].sort()
  const filteredInstalled = nodeFilter === 'ALL'
    ? installed
    : installed.filter(t => (t.portal_node_name ?? t.node) === nodeFilter)

  const filteredAvailable = availableSearch.trim()
    ? available.filter(t => {
        const q = availableSearch.toLowerCase()
        return (t.title ?? '').toLowerCase().includes(q) || t.template.toLowerCase().includes(q)
      })
    : available

  async function loadPortalNodes() {
    if (portalNodes !== null) return portalNodes
    try {
      const list = await getPortalNodes()
      setPortalNodes(list)
      return list
    } catch {
      setPortalNodes([])
      return []
    }
  }

  async function handleOpenDownload(tmpl) {
    const nodes = await loadPortalNodes()
    setDownloadTemplate(tmpl)
    setPortalNodes(nodes)
  }

  async function handleOpenUpload() {
    const nodes = await loadPortalNodes()
    setPortalNodes(nodes)
    setShowUpload(true)
  }

  async function handleDelete(tmpl) {
    setDeleting(tmpl.volid)
    setMsg(null)
    try {
      await deleteLxcTemplate({ node: tmpl.portal_node_name ?? tmpl.node, storage: tmpl.storage, volid: tmpl.volid })
      setMsg({ type: 'success', text: `${tmpl.volid} gelöscht.` })
      refetch()
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.detail ?? 'Löschen fehlgeschlagen.' })
    } finally {
      setDeleting(null)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />)}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400 rounded-lg">
          {errorMessage ?? 'Fehler beim Laden der Templates.'}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <FailedNodesBanner nodes={failedNodes} />

      {msg && (
        <p className={`text-sm ${msg.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {msg.text}
        </p>
      )}

      {/* Heruntergeladene Templates */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
            Heruntergeladene Templates ({filteredInstalled.length})
          </h2>
          <div className="flex items-center gap-2">
            {nodes.length > 1 && (
              <select
                value={nodeFilter}
                onChange={e => setNodeFilter(e.target.value)}
                className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-1 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
              >
                <option value="ALL">Alle Nodes</option>
                {nodes.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {canAdmin && (
              <button
                onClick={handleOpenUpload}
                className="btn-primary flex items-center gap-1 text-xs px-3 py-1.5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                </svg>
                Upload
              </button>
            )}
          </div>
        </div>
        {filteredInstalled.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-4">Keine Templates heruntergeladen.</p>
        ) : (
          <Section>
            {filteredInstalled.map(t => (
              <InstalledRow key={t.volid} tmpl={t} canAdmin={canAdmin} onRequestDelete={setDeleteTarget} deleting={deleting} />
            ))}
          </Section>
        )}
      </div>

      {/* Verfügbare Templates */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
            Verfügbare Templates ({availableSearch ? filteredAvailable.length + '/' + available.length : available.length})
          </h2>
          <button
            onClick={refetch}
            className="text-xs text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
          >
            ↻ Aktualisieren
          </button>
        </div>
        {available.length > 0 && (
          <div className="relative mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 pointer-events-none">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={availableSearch}
              onChange={e => setAvailableSearch(e.target.value)}
              placeholder="Templates filtern…"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-400 dark:placeholder-zinc-500"
            />
          </div>
        )}
        {available.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-4">Keine Templates verfügbar.</p>
        ) : filteredAvailable.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-4">Keine Templates für &bdquo;{availableSearch}&ldquo; gefunden.</p>
        ) : (
          <Section>
            {filteredAvailable.map(t => (
              <DownloadableRow
                key={t.template}
                tmpl={t}
                canOperator={canOperator}
                onOpenDownload={handleOpenDownload}
              />
            ))}
          </Section>
        )}
      </div>

      {downloadTemplate && portalNodes && (
        <LxcDownloadModal
          template={downloadTemplate}
          portalNodes={portalNodes}
          onClose={() => setDownloadTemplate(null)}
          onSuccess={text => {
            setMsg({ type: 'success', text })
            setTimeout(refetch, 3000)
          }}
        />
      )}

      {showUpload && portalNodes && (
        <LxcUploadModal
          portalNodes={portalNodes}
          onClose={() => setShowUpload(false)}
          onSuccess={text => {
            setMsg({ type: 'success', text })
            refetch()
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="LXC-Template löschen"
          body={`Template „${deleteTarget.volid}" wirklich löschen?`}
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={async () => {
            const tmpl = deleteTarget
            setDeleteTarget(null)
            await handleDelete(tmpl)
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
