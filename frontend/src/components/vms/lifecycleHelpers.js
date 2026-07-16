// p3portal.org
// PROJ-102: gemeinsame Helfer für die VM/LXC-Lebenszyklus-Modals.

// Nutzerlesbare Fehlermeldung für Clone/Migrate/Convert (analog diskErrMsg).
export function lifecycleErrMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  const detailStr = typeof d === 'string' ? d : null
  if (s === 403) return t('vm_lifecycle.err_403')
  if (s === 409) {
    // Backend liefert bei Stack-Block ein Objekt {error: 'vm_managed_by_stack'}.
    if (d && typeof d === 'object' && d.error === 'vm_managed_by_stack') {
      return t('vm_lifecycle.err_409_stack')
    }
    return detailStr || t('vm_lifecycle.err_409_generic')
  }
  if (s === 422) return detailStr || t('vm_lifecycle.err_422')
  if (s === 503) return detailStr || t('vm_lifecycle.err_503')
  if (s === 502) return t('vm_lifecycle.err_502')
  return detailStr || t('vm_lifecycle.err_generic')
}
