// p3portal.org
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

const ROLE_RANK = { viewer: 0, operator: 1, admin: 2 }

export default function ProtectedRoute({ children, requiredRole, requiredPermission }) {
  const { isAuthenticated, role, mustChangePw, mustSetup2fa, portalPermissions } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (mustChangePw && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />
  }

  // PROJ-106: Enforce-Pflicht ohne eingerichtetes 2FA → Zwangs-Enrollment.
  if (mustSetup2fa && location.pathname !== '/setup-2fa') {
    return <Navigate to="/setup-2fa" replace />
  }

  if (requiredRole && ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    return <Navigate to="/dashboard" replace />
  }

  if (requiredPermission && role !== 'admin' && !(portalPermissions ?? []).includes(requiredPermission)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}
