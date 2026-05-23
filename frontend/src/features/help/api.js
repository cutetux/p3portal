// p3portal.org
// PROJ-57: API-Client für das Help-Modul.
import api from '../../api/client'

const BASE = '/api/help'

export const helpApi = {
  /** Eigene User-Overrides laden */
  getMyOverrides: () => api.get(`${BASE}/overrides/me`).then(r => r.data),

  /** Alle globalen Overrides laden */
  getGlobalOverrides: () => api.get(`${BASE}/overrides/global`).then(r => r.data),

  /** Eigenen Override hochladen (Multipart-Form) */
  uploadOverride: ({ key, lang, file, consent }) => {
    const formData = new FormData()
    formData.append('key', key)
    formData.append('lang', lang)
    formData.append('consent', consent ? 'true' : 'false')
    formData.append('file', file)
    return api.post(`${BASE}/overrides`, formData).then(r => r.data)
  },

  /** Override löschen (eigener oder Admin moderiert fremden) */
  deleteOverride: (id) => api.delete(`${BASE}/overrides/${id}`).then(r => r.data),

  /** User-Override als globalen Override promoten (manage_help + Plus) */
  promoteOverride: (id) => api.post(`${BASE}/overrides/${id}/promote`).then(r => r.data),

  /** Globalen Override entfernen (manage_help) */
  deleteGlobalOverride: (key, lang) =>
    api.delete(`${BASE}/global/${encodeURIComponent(key)}/${lang}`).then(r => r.data),

  /** Alle Overrides für Admin-Tab laden (manage_help) */
  getAdminOverrides: () => api.get(`${BASE}/admin/overrides`).then(r => r.data),
}
