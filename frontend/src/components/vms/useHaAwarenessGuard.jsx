// p3portal.org
// PROJ-103: Core-Hook, der eine VM-Aktion mit der HA-Awareness-Warnung umhüllt.
// Strukturgleich zu useDependencyImpactGuard (PROJ-96): reine 409-Vertrag-Logik
// (kein Plus-Import). Fängt den 409 {error:'ha_managed', ...} der Stop-/Migrate-/
// Convert-Endpoints ab; auf Standalone/Nicht-HA kommt nie ein solcher 409 → der
// Dialog erscheint nie.
//
//   const { guardedRun, haModal } = useHaAwarenessGuard()
//   await guardedRun((confirm) => migrateVm(vmid, body, node, { confirm }), 'Migrieren')
//   // … und irgendwo im JSX:  {haModal}
//
// guardedRun(apiCall, actionLabel?) ruft apiCall(false). Liefert der Server ein
// 409 ha_managed, wird der Dialog gezeigt; „Trotzdem fortfahren" ruft apiCall(true)
// und resolved/rejected die ursprüngliche Promise. „Abbrechen" rejected mit einem
// als `cancelled` markierten Fehler, den der Aufrufer ignorieren kann.
import { useState, useCallback } from 'react'
import HaAwarenessModal from './HaAwarenessModal'

/** Vom Aufrufer abfragbar, um den Abbruch nicht als echten Fehler zu behandeln. */
export class HaAwarenessCancelled extends Error {
  constructor() {
    super('ha_awareness_cancelled')
    this.name = 'HaAwarenessCancelled'
    this.cancelled = true
  }
}

export function isHaCancelled(err) {
  return !!err?.cancelled
}

export function useHaAwarenessGuard() {
  const [state, setState] = useState(null) // { data, apiCall, label, resolve, reject }

  const guardedRun = useCallback((apiCall, actionLabel) => {
    return Promise.resolve()
      .then(() => apiCall(false))
      .catch((err) => {
        // FastAPI verpackt HTTPException(detail={...}) als {"detail": {...}} →
        // den Vertrag aus dem detail-Feld lesen (kanonisches Muster).
        const body = err?.response?.data?.detail
        if (
          err?.response?.status === 409 &&
          body && typeof body === 'object' &&
          body.error === 'ha_managed'
        ) {
          return new Promise((resolve, reject) => {
            setState({ data: body, apiCall, label: actionLabel, resolve, reject })
          })
        }
        throw err
      })
  }, [])

  const onConfirm = useCallback(async () => {
    if (!state) return
    const { apiCall, resolve, reject } = state
    try {
      const r = await apiCall(true)
      resolve(r)
    } catch (e) {
      reject(e)
    } finally {
      setState(null)
    }
  }, [state])

  const onCancel = useCallback(() => {
    if (!state) return
    state.reject(new HaAwarenessCancelled())
    setState(null)
  }, [state])

  const haModal = state
    ? <HaAwarenessModal data={state.data} actionLabel={state.label} onConfirm={onConfirm} onCancel={onCancel} />
    : null

  return { guardedRun, haModal }
}
