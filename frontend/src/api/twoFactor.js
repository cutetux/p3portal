// p3portal.org
// PROJ-106: Zwei-Faktor-Authentifizierung (TOTP) – Enrollment, Verwaltung, Admin.
import api from './client'

// ── Selbstbedienung (Profil) ──────────────────────────────────────────────────

export async function get2faStatus() {
  const { data } = await api.get('/api/me/2fa')
  return data // { enabled, pending, enforced }
}

export async function setup2fa() {
  const { data } = await api.post('/api/me/2fa/setup')
  return data // { secret, otpauth_uri, qr_svg }
}

export async function verify2fa(code) {
  const { data } = await api.post('/api/me/2fa/verify', { code })
  return data // { recovery_codes, access_token }
}

export async function disable2fa({ code = null, password = null } = {}) {
  await api.post('/api/me/2fa/disable', { code, password })
}

export async function regenerateRecoveryCodes() {
  const { data } = await api.post('/api/me/2fa/recovery/regenerate')
  return data // { recovery_codes }
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function resetUser2fa(userId) {
  const { data } = await api.post(`/api/admin/users/${userId}/2fa/reset`)
  return data
}

export async function get2faPolicy() {
  const { data } = await api.get('/api/admin/2fa/policy')
  return data // { enforce_global, enforce_roles }
}

export async function set2faPolicy(enforceGlobal, enforceRoles) {
  const { data } = await api.put('/api/admin/2fa/policy', {
    enforce_global: enforceGlobal,
    enforce_roles: enforceRoles,
  })
  return data
}
