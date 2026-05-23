// p3portal.org
import { createContext, useContext, useState, useCallback } from 'react'
import { login as apiLogin, loginLocal as apiLoginLocal, logout as apiLogout } from '../api/auth'
import { queryClient } from '../lib/queryClient'

const AuthContext = createContext(null)

function parseJwtPayload(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return {
      role: payload.role ?? 'operator',
      auth_type: payload.auth_type ?? 'proxmox',
      username: payload.sub ?? null,
      jti: payload.jti ?? null,
      mustChangePw: payload.must_change_pw === true,
      portalPermissions: Array.isArray(payload.portal_permissions) ? payload.portal_permissions : [],
    }
  } catch {
    return { role: 'operator', auth_type: 'proxmox', username: null, jti: null, mustChangePw: false, portalPermissions: [] }
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('token'))
  const [userInfo, setUserInfo] = useState(() => {
    const stored = sessionStorage.getItem('token')
    return stored ? parseJwtPayload(stored) : { role: 'operator', auth_type: 'proxmox', username: null, jti: null, mustChangePw: false, portalPermissions: [] }
  })

  const login = useCallback(async (username, password, realm) => {
    const data = await apiLogin(username, password, realm)
    sessionStorage.setItem('token', data.access_token)
    setToken(data.access_token)
    setUserInfo(parseJwtPayload(data.access_token))
  }, [])

  const loginLocal = useCallback(async (username, password) => {
    const data = await apiLoginLocal(username, password)
    sessionStorage.setItem('token', data.access_token)
    setToken(data.access_token)
    setUserInfo(parseJwtPayload(data.access_token))
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    queryClient.clear()
    setToken(null)
    setUserInfo({ role: 'operator', auth_type: 'proxmox', username: null, jti: null, mustChangePw: false, portalPermissions: [] })
  }, [])

  const updateToken = useCallback((newToken) => {
    sessionStorage.setItem('token', newToken)
    setToken(newToken)
    setUserInfo(parseJwtPayload(newToken))
  }, [])

  return (
    <AuthContext.Provider value={{
      token,
      login,
      loginLocal,
      logout,
      updateToken,
      isAuthenticated: !!token,
      role: userInfo.role,
      auth_type: userInfo.auth_type,
      username: userInfo.username,
      jti: userInfo.jti,
      mustChangePw: userInfo.mustChangePw,
      portalPermissions: userInfo.portalPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
