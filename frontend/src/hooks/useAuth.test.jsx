// p3portal.org
import { render, screen, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AuthProvider, useAuth } from './useAuth'

vi.mock('../api/auth', () => ({
  login: vi.fn(),
  loginLocal: vi.fn(),
  loginTwoFactor: vi.fn(),
  logout: vi.fn(),
}))

import { login as mockLogin, loginLocal as mockLoginLocal, loginTwoFactor as mockLoginTwoFactor, logout as mockLogout } from '../api/auth'

// Creates a minimal fake JWT with a given JSON payload
function makeJwt(payload) {
  const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  const body = btoa(JSON.stringify(payload))
  return `${header}.${body}.fake-signature`
}

function TestConsumer() {
  const { isAuthenticated, token, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => login('user', 'pass', 'pam')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  )
}

function TestConsumerFull() {
  const { isAuthenticated, role, auth_type, username } = useAuth()
  return (
    <div>
      <span data-testid="auth-status">{isAuthenticated ? 'authenticated' : 'unauthenticated'}</span>
      <span data-testid="role">{role}</span>
      <span data-testid="auth-type">{auth_type}</span>
      <span data-testid="username">{username ?? 'none'}</span>
    </div>
  )
}

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>

describe('useAuth', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.clearAllMocks()
  })

  // ── Existing tests (unchanged) ───────────────────────────────────────────────

  it('initialises as unauthenticated when no token in sessionStorage', () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByTestId('auth-status').textContent).toBe('unauthenticated')
    expect(screen.getByTestId('token').textContent).toBe('none')
  })

  it('initialises as authenticated when token already in sessionStorage', () => {
    sessionStorage.setItem('token', 'existing-jwt')
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByTestId('auth-status').textContent).toBe('authenticated')
    expect(screen.getByTestId('token').textContent).toBe('existing-jwt')
  })

  it('login() stores token in sessionStorage and updates state', async () => {
    mockLogin.mockResolvedValue({ access_token: 'new-jwt', token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.login('user', 'pass', 'pam')
    })

    expect(sessionStorage.getItem('token')).toBe('new-jwt')
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('login() passes username, password, realm to apiLogin', async () => {
    mockLogin.mockResolvedValue({ access_token: 'tok', token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.login('user', 'pass', 'pam')
    })

    expect(mockLogin).toHaveBeenCalledWith('user', 'pass', 'pam')
  })

  it('login() propagates errors so callers can handle them', async () => {
    mockLogin.mockRejectedValue(new Error('Proxmox down'))
    const { result } = renderHook(() => useAuth(), { wrapper })

    await expect(
      act(async () => { await result.current.login('user', 'pass', 'pam') })
    ).rejects.toThrow('Proxmox down')

    expect(sessionStorage.getItem('token')).toBeNull()
    expect(result.current.isAuthenticated).toBe(false)
  })

  it('logout() clears token from state', async () => {
    sessionStorage.setItem('token', 'existing-jwt')
    mockLogout.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isAuthenticated).toBe(true)

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.token).toBeNull()
  })

  it('useAuth() throws when used outside AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used within AuthProvider')
    spy.mockRestore()
  })

  // ── PROJ-8: JWT payload parsing ───────────────────────────────────────────────

  it('defaults to role=operator, auth_type=proxmox for non-parseable token', () => {
    sessionStorage.setItem('token', 'existing-jwt')
    render(<AuthProvider><TestConsumerFull /></AuthProvider>)
    expect(screen.getByTestId('role').textContent).toBe('operator')
    expect(screen.getByTestId('auth-type').textContent).toBe('proxmox')
    expect(screen.getByTestId('username').textContent).toBe('none')
  })

  it('extracts role, auth_type and username from JWT payload after login()', async () => {
    const jwt = makeJwt({ sub: 'admin', auth_type: 'local', role: 'admin', exp: 9999999999 })
    mockLogin.mockResolvedValue({ access_token: jwt, token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.login('admin', 'pass', 'pam')
    })

    expect(result.current.role).toBe('admin')
    expect(result.current.auth_type).toBe('local')
    expect(result.current.username).toBe('admin')
  })

  it('reads role from JWT stored in sessionStorage on initialisation', () => {
    const jwt = makeJwt({ sub: 'admin', auth_type: 'local', role: 'admin', exp: 9999999999 })
    sessionStorage.setItem('token', jwt)
    render(<AuthProvider><TestConsumerFull /></AuthProvider>)
    expect(screen.getByTestId('role').textContent).toBe('admin')
    expect(screen.getByTestId('auth-type').textContent).toBe('local')
    expect(screen.getByTestId('username').textContent).toBe('admin')
  })

  // ── PROJ-8: loginLocal() ──────────────────────────────────────────────────────

  it('loginLocal() calls apiLoginLocal with username and password', async () => {
    const jwt = makeJwt({ sub: 'helpdesk', auth_type: 'local', role: 'operator', exp: 9999999999 })
    mockLoginLocal.mockResolvedValue({ access_token: jwt, token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.loginLocal('helpdesk', 'supersecret')
    })

    expect(mockLoginLocal).toHaveBeenCalledWith('helpdesk', 'supersecret')
  })

  it('loginLocal() stores token and updates role/auth_type', async () => {
    const jwt = makeJwt({ sub: 'helpdesk', auth_type: 'local', role: 'operator', exp: 9999999999 })
    mockLoginLocal.mockResolvedValue({ access_token: jwt, token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.loginLocal('helpdesk', 'supersecret')
    })

    expect(sessionStorage.getItem('token')).toBe(jwt)
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.role).toBe('operator')
    expect(result.current.auth_type).toBe('local')
    expect(result.current.username).toBe('helpdesk')
  })

  it('loginLocal() propagates errors so callers can handle them', async () => {
    mockLoginLocal.mockRejectedValue(new Error('Login failed'))
    const { result } = renderHook(() => useAuth(), { wrapper })

    await expect(
      act(async () => { await result.current.loginLocal('wrong', 'wrong') })
    ).rejects.toThrow('Login failed')

    expect(result.current.isAuthenticated).toBe(false)
  })

  it('logout() resets role and auth_type to defaults', async () => {
    const jwt = makeJwt({ sub: 'admin', auth_type: 'local', role: 'admin', exp: 9999999999 })
    sessionStorage.setItem('token', jwt)
    mockLogout.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.role).toBe('admin')

    await act(async () => {
      await result.current.logout()
    })

    expect(result.current.role).toBe('operator')
    expect(result.current.auth_type).toBe('proxmox')
    expect(result.current.isAuthenticated).toBe(false)
  })

  // ── PROJ-14: jti + mustChangePw ───────────────────────────────────────────────

  it('extracts jti from JWT payload', async () => {
    const jwt = makeJwt({ sub: 'alice', auth_type: 'local', role: 'operator', exp: 9999999999, jti: 'my-session-uuid' })
    mockLoginLocal.mockResolvedValue({ access_token: jwt })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.loginLocal('alice', 'pass') })
    expect(result.current.jti).toBe('my-session-uuid')
  })

  it('sets jti=null when claim is absent', async () => {
    const jwt = makeJwt({ sub: 'alice', auth_type: 'local', role: 'operator', exp: 9999999999 })
    mockLoginLocal.mockResolvedValue({ access_token: jwt })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.loginLocal('alice', 'pass') })
    expect(result.current.jti).toBeNull()
  })

  it('sets mustChangePw=true when must_change_pw claim is true', async () => {
    const jwt = makeJwt({ sub: 'bob', auth_type: 'local', role: 'operator', exp: 9999999999, must_change_pw: true })
    mockLoginLocal.mockResolvedValue({ access_token: jwt })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.loginLocal('bob', 'tmppass123') })
    expect(result.current.mustChangePw).toBe(true)
  })

  it('sets mustChangePw=false when must_change_pw claim is absent', async () => {
    const jwt = makeJwt({ sub: 'bob', auth_type: 'local', role: 'operator', exp: 9999999999 })
    mockLoginLocal.mockResolvedValue({ access_token: jwt })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.loginLocal('bob', 'pass') })
    expect(result.current.mustChangePw).toBe(false)
  })

  it('reads mustChangePw from JWT in sessionStorage on init', () => {
    const jwt = makeJwt({ sub: 'charlie', auth_type: 'local', role: 'operator', exp: 9999999999, must_change_pw: true })
    sessionStorage.setItem('token', jwt)
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.mustChangePw).toBe(true)
  })

  it('updateToken() replaces token and re-parses payload', async () => {
    const jwtOld = makeJwt({ sub: 'charlie', auth_type: 'local', role: 'operator', exp: 9999999999, must_change_pw: true })
    const jwtNew = makeJwt({ sub: 'charlie', auth_type: 'local', role: 'operator', exp: 9999999999 })
    sessionStorage.setItem('token', jwtOld)
    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.mustChangePw).toBe(true)

    act(() => { result.current.updateToken(jwtNew) })

    expect(result.current.mustChangePw).toBe(false)
    expect(result.current.isAuthenticated).toBe(true)
    expect(sessionStorage.getItem('token')).toBe(jwtNew)
  })

  it('logout() resets jti and mustChangePw to defaults', async () => {
    const jwt = makeJwt({ sub: 'dave', auth_type: 'local', role: 'admin', exp: 9999999999, jti: 'session-1', must_change_pw: true })
    sessionStorage.setItem('token', jwt)
    mockLogout.mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => { await result.current.logout() })

    expect(result.current.jti).toBeNull()
    expect(result.current.mustChangePw).toBe(false)
  })

  // ── PROJ-109: "Angemeldet bleiben" (Persistenz-Wahl) ─────────────────────────

  it('login(remember=true) legt Token in localStorage ab (nicht sessionStorage)', async () => {
    mockLogin.mockResolvedValue({ access_token: 'jwt-remember', token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.login('user', 'pass', 'pam', true)
    })

    expect(localStorage.getItem('token')).toBe('jwt-remember')
    expect(sessionStorage.getItem('token')).toBeNull()
    expect(result.current.isAuthenticated).toBe(true)
  })

  it('login(remember=false) bleibt in sessionStorage (Default)', async () => {
    mockLogin.mockResolvedValue({ access_token: 'jwt-session', token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.login('user', 'pass', 'pam', false)
    })

    expect(sessionStorage.getItem('token')).toBe('jwt-session')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('loginLocal(remember=true) legt Token in localStorage ab', async () => {
    mockLoginLocal.mockResolvedValue({ access_token: 'jwt-local-remember', token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.loginLocal('user', 'pass', true)
    })

    expect(localStorage.getItem('token')).toBe('jwt-local-remember')
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('completeTwoFactor(remember=true) legt Token in localStorage ab', async () => {
    mockLoginTwoFactor.mockResolvedValue({ access_token: 'jwt-2fa-remember', token_type: 'bearer' })
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {
      await result.current.completeTwoFactor('pre-auth', '123456', true)
    })

    expect(localStorage.getItem('token')).toBe('jwt-2fa-remember')
    expect(sessionStorage.getItem('token')).toBeNull()
  })

  it('initialisiert authentifiziert, wenn Token nur in localStorage liegt', () => {
    localStorage.setItem('token', 'persisted-jwt')
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByTestId('auth-status').textContent).toBe('authenticated')
    expect(screen.getByTestId('token').textContent).toBe('persisted-jwt')
  })
})
