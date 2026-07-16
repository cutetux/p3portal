// p3portal.org
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import axios from 'axios'

const REALMS = [
  { value: 'pam', label: 'Linux PAM' },
  { value: 'pve', label: 'Proxmox VE' },
  { value: 'ldap', label: 'LDAP' },
  { value: 'ad', label: 'Active Directory' },
]

const inputCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-portal-accent/50 focus:ring-1 focus:ring-portal-accent transition'

export default function LoginPage() {
  const { t } = useTranslation()
  const { login, loginLocal, completeTwoFactor } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('local')
  const [form, setForm] = useState({ username: '', password: '', realm: 'pam' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [proxmoxLoginEnabled, setProxmoxLoginEnabled] = useState(false)
  // PROJ-109: "Angemeldet bleiben" (Opt-in Login-Persistenz)
  const [remember, setRemember] = useState(false)
  // PROJ-106: 2FA-Challenge-Schritt
  const [twoFactor, setTwoFactor] = useState(null) // { preAuthToken }
  const [tfaCode, setTfaCode] = useState('')

  useEffect(() => {
    axios.get('/api/setup/features')
      .then(r => setProxmoxLoginEnabled(r.data.proxmox_login_enabled ?? false))
      .catch(() => setProxmoxLoginEnabled(false))
  }, [])

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const handleModeChange = (m) => {
    setMode(m)
    setError('')
    setForm({ username: '', password: '', realm: 'pam' })
    setTwoFactor(null)
    setTfaCode('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'proxmox') {
        await login(form.username, form.password, form.realm, remember)
        navigate('/dashboard')
      } else {
        const res = await loginLocal(form.username, form.password, remember)
        if (res?.twoFactorRequired) {
          // Kein Login – Challenge-Schritt anzeigen.
          setTwoFactor({ preAuthToken: res.preAuthToken })
          setForm(f => ({ ...f, password: '' }))
          return
        }
        navigate('/dashboard')
      }
    } catch (err) {
      const status = err.response?.status
      if (status === 401) setError(t('login.err_401'))
      else if (status === 429) setError(t('login.err_429'))
      else if (status === 502) setError(t('login.err_502'))
      else setError(t('login.err_default'))
    } finally {
      setLoading(false)
    }
  }

  const handleTwoFactorSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await completeTwoFactor(twoFactor.preAuthToken, tfaCode.trim(), remember)
      navigate('/dashboard')
    } catch (err) {
      const status = err.response?.status
      if (status === 401) setError(t('two_factor.login.err_code'))
      else if (status === 429) setError(t('login.err_429'))
      else setError(t('login.err_default'))
    } finally {
      setLoading(false)
    }
  }

  const cancelTwoFactor = () => {
    setTwoFactor(null)
    setTfaCode('')
    setError('')
    setForm({ username: '', password: '', realm: 'pam' })
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight uppercase">P3 Portal</h1>
          <p className="text-gray-500 dark:text-zinc-500 text-sm mt-1">{t('common.tagline')}</p>
        </div>

        {twoFactor ? (
          <form onSubmit={handleTwoFactorSubmit} className="bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 p-8 space-y-5">
            <div className="bg-portal-info/10 border border-portal-info/30 px-3 py-2">
              <p className="text-sm text-portal-info">{t('two_factor.login.prompt')}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                {t('two_factor.login.label_code')}
              </label>
              <input
                name="tfa_code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                required
                autoFocus
                value={tfaCode}
                onChange={(e) => setTfaCode(e.target.value)}
                placeholder={t('two_factor.login.placeholder')}
                className={inputCls}
              />
              <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">{t('two_factor.login.hint_recovery')}</p>
            </div>

            {error && (
              <p className="text-portal-danger text-sm bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? t('login.signing_in') : t('two_factor.login.btn_verify')}
            </button>
            <button type="button" onClick={cancelTwoFactor} className="btn-secondary w-full">
              {t('two_factor.login.btn_cancel')}
            </button>
          </form>
        ) : (
        <>
        <div className="flex border border-gray-300 dark:border-zinc-700 border-b-0">
          {proxmoxLoginEnabled && (
            <button
              type="button"
              onClick={() => handleModeChange('proxmox')}
              className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
                mode === 'proxmox'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-gray-200 dark:bg-zinc-900 text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300'
              }`}
            >
              {t('login.proxmox_login')}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleModeChange('local')}
            className={`flex-1 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
              proxmoxLoginEnabled ? 'border-l border-gray-300 dark:border-zinc-700' : ''
            } ${
              mode === 'local'
                ? 'bg-[var(--accent)] text-white'
                : 'bg-gray-200 dark:bg-zinc-900 text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300'
            }`}
          >
            {t('login.portal_login')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 p-8 space-y-5">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
              {t('login.label_username')}
            </label>
            <input
              name="username"
              type="text"
              required
              autoFocus
              value={form.username}
              onChange={handleChange}
              placeholder={mode === 'proxmox' ? t('login.placeholder_proxmox') : t('login.placeholder_local')}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
              {t('login.label_password')}
            </label>
            <input
              name="password"
              type="password"
              required
              value={form.password}
              onChange={handleChange}
              className={inputCls}
            />
          </div>

          {mode === 'proxmox' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                {t('login.label_realm')}
              </label>
              <select
                name="realm"
                value={form.realm}
                onChange={handleChange}
                className={inputCls}
              >
                {REALMS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="text-portal-danger text-sm bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
              {error}
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-400 select-none cursor-pointer">
            <input
              type="checkbox"
              name="remember"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 accent-portal-accent"
            />
            {t('login.remember_me')}
          </label>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? t('login.signing_in') : t('login.btn_signin')}
          </button>
        </form>
        </>
        )}

        <p className="text-center text-xs text-gray-400 dark:text-zinc-700 mt-6">p3portal.org</p>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
