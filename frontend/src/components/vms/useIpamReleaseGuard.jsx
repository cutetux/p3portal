// p3portal.org
// PROJ-42 Phase 2: Core-Hook, der eine VM-Aktion (Löschen) mit der IPAM-Freigabe-
// Warnung umhüllt. Rein 409-Vertrag-Logik (kein Plus-Import → kein Core-Bundle-
// Leak; im Core-Mode kommt nie ein 409 → der Dialog erscheint nie). Strukturell
// identisch zu useDependencyImpactGuard, matcht aber den 409 `ipam_allocation_impact`.
//
//   const { guardedRun, ipamModal } = useIpamReleaseGuard()
//   await guardedRun((confirm) => deleteVm(vmid, node, { confirm }))
//   // … und irgendwo im JSX:  {ipamModal}
//
// In VmTable wird dieser Guard IM Dependency-Guard verschachtelt (beide teilen das
// confirm-Flag; das Backend prüft Dependency vor IPAM) – analog HA-in-Stop (PROJ-103).
import { useState, useCallback } from 'react'
import IpamReleaseImpactModal from './IpamReleaseImpactModal'

export class IpamReleaseCancelled extends Error {
  constructor() {
    super('ipam_release_cancelled')
    this.name = 'IpamReleaseCancelled'
    this.cancelled = true
  }
}

export function useIpamReleaseGuard() {
  const [state, setState] = useState(null) // { data, apiCall, resolve, reject }

  const guardedRun = useCallback((apiCall) => {
    return Promise.resolve()
      .then(() => apiCall(false))
      .catch((err) => {
        const body = err?.response?.data?.detail
        if (
          err?.response?.status === 409 &&
          body && typeof body === 'object' &&
          body.error === 'ipam_allocation_impact'
        ) {
          return new Promise((resolve, reject) => {
            setState({ data: body, apiCall, resolve, reject })
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
    state.reject(new IpamReleaseCancelled())
    setState(null)
  }, [state])

  const ipamModal = state
    ? <IpamReleaseImpactModal data={state.data} onConfirm={onConfirm} onCancel={onCancel} />
    : null

  return { guardedRun, ipamModal }
}
