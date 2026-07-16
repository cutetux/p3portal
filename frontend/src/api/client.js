// p3portal.org
import axios from 'axios'
import { getToken, clearToken } from './tokenStorage'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE ?? '',
  timeout: 10000,
})

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Nur umleiten wenn ein Token vorhanden war – unauthentifizierte Requests
    // (Setup-Wizard, Capabilities-Probe) sollen stillschweigend fehlschlagen.
    if (err.response?.status === 401
        && !err.config?.url?.includes('/api/auth/login')
        && window.location.pathname !== '/login'
        && getToken()) {
      clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
