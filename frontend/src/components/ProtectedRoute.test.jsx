// p3portal.org
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Mock useAuth – wird vor dem Import von ProtectedRoute aufgelöst
let mockAuthState = {}
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}))

import ProtectedRoute from './ProtectedRoute'

// ── Helfer für saubere Render ────────────────────────────────────────────────

function renderProtectedRoute(props) {
  const {
    isAuthenticated = true,
    role = 'operator',
    mustChangePw = false,
    portalPermissions = [],
    requiredRole,
    requiredPermission,
    initialPath = '/protected',
  } = props

  mockAuthState = { isAuthenticated, role, mustChangePw, portalPermissions }

  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/dashboard" element={<div data-testid="dashboard" />} />
        <Route path="/change-password" element={<div data-testid="change-pw" />} />
        <Route
          path="/protected"
          element={
            <ProtectedRoute requiredRole={requiredRole} requiredPermission={requiredPermission}>
              <div data-testid="protected-content">Geschützter Inhalt</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    mockAuthState = {}
  })

  // ── Basis-Auth ───────────────────────────────────────────────────────────────

  it('zeigt Inhalt für authentifizierten Nutzer ohne Einschränkungen', () => {
    const { getByTestId } = renderProtectedRoute({ isAuthenticated: true })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  it('leitet nicht authentifizierter Nutzer zu /login weiter', () => {
    const { getByTestId, queryByTestId } = renderProtectedRoute({ isAuthenticated: false })
    expect(getByTestId('login-page')).toBeTruthy()
    expect(queryByTestId('protected-content')).toBeNull()
  })

  // ── mustChangePw ─────────────────────────────────────────────────────────────

  it('leitet zu /change-password weiter wenn mustChangePw=true', () => {
    const { getByTestId, queryByTestId } = renderProtectedRoute({
      isAuthenticated: true,
      mustChangePw: true,
      initialPath: '/protected',
    })
    expect(getByTestId('change-pw')).toBeTruthy()
    expect(queryByTestId('protected-content')).toBeNull()
  })

  // ── requiredRole ─────────────────────────────────────────────────────────────

  it('zeigt Inhalt wenn Rolle ausreichend ist (admin >= operator)', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'admin',
      requiredRole: 'operator',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  it('zeigt Inhalt wenn Rolle exakt übereinstimmt', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'operator',
      requiredRole: 'operator',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  it('leitet zu /dashboard weiter wenn Rolle nicht ausreicht (viewer < operator)', () => {
    const { getByTestId, queryByTestId } = renderProtectedRoute({
      role: 'viewer',
      requiredRole: 'operator',
    })
    expect(getByTestId('dashboard')).toBeTruthy()
    expect(queryByTestId('protected-content')).toBeNull()
  })

  // ── requiredPermission: Admin bekommt immer Zugriff ─────────────────────────

  it('Admin sieht Inhalt auch ohne explizite Permission (implizit alle Rechte)', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'admin',
      portalPermissions: [],
      requiredPermission: 'manage_users',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  // ── requiredPermission: Nutzer mit passender Permission ──────────────────────

  it('Operator mit manage_users-Permission sieht geschützten Inhalt', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'operator',
      portalPermissions: ['manage_users'],
      requiredPermission: 'manage_users',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  it('Viewer mit manage_nodes-Permission sieht geschützten Inhalt', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'viewer',
      portalPermissions: ['manage_nodes'],
      requiredPermission: 'manage_nodes',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  it('Operator mit manage_settings-Permission sieht geschützten Inhalt', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'operator',
      portalPermissions: ['manage_settings'],
      requiredPermission: 'manage_settings',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  it('Operator mit manage_api_keys-Permission sieht geschützten Inhalt', () => {
    const { getByTestId } = renderProtectedRoute({
      role: 'operator',
      portalPermissions: ['manage_api_keys'],
      requiredPermission: 'manage_api_keys',
    })
    expect(getByTestId('protected-content')).toBeTruthy()
  })

  // ── requiredPermission: Nutzer OHNE passende Permission → /dashboard ─────────

  it('Operator ohne manage_users-Permission wird zu /dashboard geleitet', () => {
    const { getByTestId, queryByTestId } = renderProtectedRoute({
      role: 'operator',
      portalPermissions: [],
      requiredPermission: 'manage_users',
    })
    expect(getByTestId('dashboard')).toBeTruthy()
    expect(queryByTestId('protected-content')).toBeNull()
  })

  it('Operator mit manage_nodes aber nicht manage_settings wird bei manage_settings geleitet', () => {
    const { getByTestId, queryByTestId } = renderProtectedRoute({
      role: 'operator',
      portalPermissions: ['manage_nodes'],
      requiredPermission: 'manage_settings',
    })
    expect(getByTestId('dashboard')).toBeTruthy()
    expect(queryByTestId('protected-content')).toBeNull()
  })

  // ── portalPermissions=null/undefined defensive ────────────────────────────────

  it('behandelt portalPermissions=undefined graceful (kein Crash)', () => {
    const { getByTestId, queryByTestId } = renderProtectedRoute({
      role: 'operator',
      portalPermissions: undefined,
      requiredPermission: 'manage_users',
    })
    expect(getByTestId('dashboard')).toBeTruthy()
    expect(queryByTestId('protected-content')).toBeNull()
  })
})

// ── useAuth: portalPermissions aus JWT ──────────────────────────────────────

describe('useAuth – portalPermissions aus JWT', () => {
  // Diese Tests prüfen parseJwtPayload indirekt über den Hook
  // Direkte Tests sind in useAuth.test.jsx

  it('ProtectedRoute liest portalPermissions aus useAuth korrekt', () => {
    mockAuthState = {
      isAuthenticated: true,
      role: 'operator',
      mustChangePw: false,
      portalPermissions: ['manage_users', 'view_logs'],
    }

    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/dashboard" element={<div data-testid="dashboard" />} />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute requiredPermission="manage_users">
                <div data-testid="users-page">Users</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    )

    expect(getByTestId('users-page')).toBeTruthy()
  })
})
