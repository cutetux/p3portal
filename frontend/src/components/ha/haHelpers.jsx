// p3portal.org
// PROJ-103: geteilte Helfer für die HA-Komponenten (Fehler-Mapping, Availability-
// Banner, Zustands-Badge). Alle Read-Antworten tragen die Availability-Flags
// (ha_unavailable / permission_denied / cluster_unreachable / detail).
import { useTranslation } from 'react-i18next'

/** Nutzerlesbare Meldung für einen Schreib-Fehler (write endpoints). */
export function haErrMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('ha.err_403')
  if (s === 503) return t('ha.err_503')
  if (s === 502) return t('ha.err_502')
  if (s === 409) return typeof d === 'string' ? d : t('ha.err_conflict')
  return (typeof d === 'string' ? d : null) ?? t('ha.err_generic')
}

/** True, wenn eine Read-Antwort einen Availability-/Fehlerzustand signalisiert. */
export function isUnavailable(resp) {
  return Boolean(
    resp?.ha_unavailable || resp?.permission_denied || resp?.cluster_unreachable,
  )
}

/** Banner für nicht-verfügbare HA (Standalone / fehlende Rechte / nicht erreichbar). */
export function AvailabilityBanner({ resp }) {
  const { t } = useTranslation()
  if (!resp || !isUnavailable(resp)) return null
  let msg
  if (resp.ha_unavailable) msg = t('ha.unavailable')
  else if (resp.permission_denied) msg = t('ha.permission_denied')
  else msg = resp.detail || t('ha.cluster_unreachable')
  return (
    <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
      {msg}
    </div>
  )
}

/** Farbiges Badge für den Live-Zustand einer HA-Ressource. */
export function HaStateBadge({ state }) {
  const { t } = useTranslation()
  const s = (state || '').toLowerCase()
  let cls = 'bg-gray-200/60 text-gray-600 dark:bg-zinc-700/60 dark:text-zinc-300'
  if (s === 'started') cls = 'bg-portal-success/10 text-portal-success'
  else if (s === 'error' || s === 'fence') cls = 'bg-portal-danger/10 text-portal-danger'
  else if (s === 'stopped' || s === 'disabled') cls = 'bg-gray-300/50 text-gray-600 dark:bg-zinc-700 dark:text-zinc-300'
  else if (s.includes('migrate') || s.includes('relocate') || s.includes('request')) cls = 'bg-portal-warn/10 text-portal-warn'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${cls}`}>
      {state || t('ha.state_unknown')}
    </span>
  )
}

export function thCls() {
  return 'px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider'
}
