// p3portal.org
import api from './client'
import { clearToken } from './tokenStorage'

export async function login(username, password, realm) {
  const { data } = await api.post('/api/auth/login', { username, password, realm })
  return data
}

export async function loginLocal(username, password) {
  const { data } = await api.post('/api/auth/login/local', { username, password })
  return data
}

// PROJ-106: Zweiter Login-Schritt – löst das Pre-Auth-Token gegen TOTP-/Recovery-Code ein.
export async function loginTwoFactor(preAuthToken, code) {
  const { data } = await api.post('/api/auth/login/2fa', { pre_auth_token: preAuthToken, code })
  return data
}

export async function logout() {
  await api.post('/api/auth/logout').catch(() => {})
  clearToken()
}

export async function getPermissions() {
  const { data } = await api.get('/api/me/permissions')
  return data
}

export async function getMe() {
  const { data } = await api.get('/api/me')
  return data
}
