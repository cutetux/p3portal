// p3portal.org
// PROJ-42 Phase 2: IPAM-Freigabe-Warnung beim VM-Löschen. Rein Core: basiert
// ausschließlich auf dem HTTP-409-Vertrag von DELETE /api/vms/{id}
// ({error:'ipam_allocation_impact', count, allocations}). Im Core-Mode liefert das
// Backend diesen 409 nie (Plus-Hook No-Op) → der Dialog erscheint nie. Daher kein
// Plus-Import und kein Core-Bundle-Leak. DE-Texte hartkodiert, konsistent mit
// DependencyImpactModal / den umgebenden Core-VM-Komponenten.
import { useState } from 'react'

export default function IpamReleaseImpactModal({ data, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const allocs = data?.allocations || []
  const count = data?.count ?? allocs.length

  const handle = async () => {
    if (busy) return
    setBusy(true)
    await onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ipam-impact-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="ipam-impact-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            IP-Adresse wird freigegeben
          </h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-zinc-300">
            {count === 1
              ? 'Diese VM hält eine reservierte IP-Adresse. Beim Löschen wird sie freigegeben:'
              : `Diese VM hält ${count} reservierte IP-Adressen. Beim Löschen werden sie freigegeben:`}
          </p>
          <ul className="rounded-md border border-portal-warn/30 bg-portal-warn/10 divide-y divide-portal-warn/20 max-h-48 overflow-y-auto">
            {allocs.map((a, i) => (
              <li key={`${a.id ?? a.ip}-${i}`} className="px-3 py-1.5 text-xs">
                <span className="font-mono text-gray-900 dark:text-zinc-100">{a.ip}</span>
                {a.status && <span className="text-gray-400 dark:text-zinc-500"> · {a.status}</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            VM löschen und IP freigeben?
          </p>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            Abbrechen
          </button>
          <button type="button" onClick={handle} disabled={busy} className="btn-danger">
            {busy ? '…' : 'Löschen & freigeben'}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
