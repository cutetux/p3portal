// p3portal.org
import api from './client'

// ── Profile (own keys) ────────────────────────────────────────────────────────

export async function listMyApiKeys() {
  const { data } = await api.get('/api/profile/api-keys')
  return data
}

export async function createMyApiKey({ name, scopes, expires_in_days }) {
  const { data } = await api.post('/api/profile/api-keys', {
    name,
    scopes,
    expires_in_days,
  })
  return data
}

export async function revokeMyApiKey(keyId) {
  await api.delete(`/api/profile/api-keys/${keyId}`)
}

// ── Admin (per-user settings) ─────────────────────────────────────────────────

export async function getApiKeySettings(userId) {
  const { data } = await api.get(`/api/admin/users/${userId}/api-key-settings`)
  return data
}

export async function updateApiKeySettings(userId, { enabled, allowedScopes, maxCount }) {
  await api.put(`/api/admin/users/${userId}/api-key-settings`, {
    api_keys_enabled: enabled,
    api_keys_allowed_scopes: allowedScopes ?? null,
    api_keys_max_count: maxCount ?? null,
  })
}

// ── API-Surface (PROJ-44) ─────────────────────────────────────────────────────

export async function getScopeManifest() {
  const { data } = await api.get('/api/scopes/manifest')
  return data
}

export async function getApiVersion() {
  const { data } = await api.get('/api/version')
  return data
}

export async function fetchExternalCalls({ keyName, scope, authKind, limit = 200 } = {}) {
  const params = new URLSearchParams()
  if (keyName) params.set('key_name', keyName)
  if (scope) params.set('scope', scope)
  if (authKind) params.set('auth_kind', authKind)
  params.set('limit', limit)
  const { data } = await api.get(`/api/admin/external-calls?${params.toString()}`)
  return data
}
