// p3portal.org
// PROJ-60: API-Wrapper für GET /api/capabilities (PROJ-67: jetzt auth-gated, schlägt ohne JWT still fehl)
import apiClient from './client'

export async function fetchCapabilities() {
  const { data } = await apiClient.get('/api/capabilities')
  return data
}
