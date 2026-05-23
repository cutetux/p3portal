// p3portal.org
import api from './client'

export async function login(username, password, realm) {
  const { data } = await api.post('/api/auth/login', { username, password, realm })
  return data
}

export async function loginLocal(username, password) {
  const { data } = await api.post('/api/auth/login/local', { username, password })
  return data
}

export async function logout() {
  await api.post('/api/auth/logout').catch(() => {})
  sessionStorage.removeItem('token')
}

export async function getPermissions() {
  const { data } = await api.get('/api/me/permissions')
  return data
}

export async function getMe() {
  const { data } = await api.get('/api/me')
  return data
}
