// p3portal.org
import { createContext, useContext, useState, useCallback } from 'react'
import { login as apiLogin, loginLocal as apiLoginLocal, loginTwoFactor as apiLoginTwoFactor, logout as apiLogout } from '../api/auth'
import { getToken, persistToken, refreshToken } from '../api/tokenStorage'
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
      mustSetup2fa: payload.must_setup_2fa === true,
      portalPermissions: Array.isArray(payload.portal_permissions) ? payload.portal_permissions : [],
    }
  } catch {
    return { role: 'operator', auth_type: 'proxmox', username: null, jti: null, mustChangePw: false, mustSetup2fa: false, portalPermissions: [] }
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getToken())
  const [userInfo, setUserInfo] = useState(() => {
    const stored = getToken()
    return stored ? parseJwtPayload(stored) : { role: 'operator', auth_type: 'proxmox', username: null, jti: null, mustChangePw: false, mustSetup2fa: false, portalPermissions: [] }
  })

  // PROJ-109: `remember` steuert die Persistenz (localStorage vs. sessionStorage).
  const login = useCallback(async (username, password, realm, remember = false) => {
    const data = await apiLogin(username, password, realm)
    persistToken(data.access_token, remember)
    setToken(data.access_token)
    setUserInfo(parseJwtPayload(data.access_token))
  }, [])

  const loginLocal = useCallback(async (username, password, remember = false) => {
    const data = await apiLoginLocal(username, password)
    // PROJ-106: 2FA aktiv → noch KEIN Login; Aufrufer zeigt den Challenge-Schritt.
    if (data.two_factor_required) {
      return { twoFactorRequired: true, preAuthToken: data.pre_auth_token }
    }
    persistToken(data.access_token, remember)
    setToken(data.access_token)
    setUserInfo(parseJwtPayload(data.access_token))
    return { twoFactorRequired: false }
  }, [])

  // PROJ-106: Zweiter Login-Schritt – Pre-Auth-Token + Code → Voll-JWT.
  // PROJ-109: `remember` aus dem ersten Schritt wird hier durchgereicht.
  const completeTwoFactor = useCallback(async (preAuthToken, code, remember = false) => {
    const data = await apiLoginTwoFactor(preAuthToken, code)
    persistToken(data.access_token, remember)
    setToken(data.access_token)
    setUserInfo(parseJwtPayload(data.access_token))
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    queryClient.clear()
    setToken(null)
    setUserInfo({ role: 'operator', auth_type: 'proxmox', username: null, jti: null, mustChangePw: false, mustSetup2fa: false, portalPermissions: [] })
  }, [])

  const updateToken = useCallback((newToken) => {
    // PROJ-109: bestehenden Ablageort (remember-Wahl) beibehalten.
    refreshToken(newToken)
    setToken(newToken)
    setUserInfo(parseJwtPayload(newToken))
  }, [])

  return (
    <AuthContext.Provider value={{
      token,
      login,
      loginLocal,
      completeTwoFactor,
      logout,
      updateToken,
      isAuthenticated: !!token,
      role: userInfo.role,
      auth_type: userInfo.auth_type,
      username: userInfo.username,
      jti: userInfo.jti,
      mustChangePw: userInfo.mustChangePw,
      mustSetup2fa: userInfo.mustSetup2fa,
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
