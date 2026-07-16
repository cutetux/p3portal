// p3portal.org
// PROJ-106: Enforce-Richtlinie für 2FA (global + pro Rolle). Admin-only.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { get2faPolicy, set2faPolicy } from '../../api/twoFactor'

const ROLES = ['admin', 'operator', 'viewer', 'restricted']

export default function TwoFactorPolicySection() {
  const { t } = useTranslation()
  const [global, setGlobal] = useState(false)
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    get2faPolicy()
      .then((p) => { setGlobal(p.enforce_global); setRoles(p.enforce_roles || []) })
      .catch(() => setError(t('two_factor.policy.err_load')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRole = (r) => {
    setSaved(false)
    setRoles((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r])
  }

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      const p = await set2faPolicy(global, roles)
      setGlobal(p.enforce_global)
      setRoles(p.enforce_roles || [])
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err.response?.data?.detail ?? t('two_factor.policy.err_save'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="h-24 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-1">{t('two_factor.policy.title')}</h3>
      <p className="text-xs text-gray-500 dark:text-zinc-500 mb-4">{t('two_factor.policy.subtitle')}</p>

      {error && (
        <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 mb-3">{error}</p>
      )}

      <label className="flex items-center gap-2 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={global}
          onChange={(e) => { setGlobal(e.target.checked); setSaved(false) }}
          className="accent-portal-accent"
        />
        <span className="text-sm text-gray-800 dark:text-zinc-200">{t('two_factor.policy.global')}</span>
      </label>

      <div className={global ? 'opacity-40 pointer-events-none' : ''}>
        <p className="text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-2">{t('two_factor.policy.per_role')}</p>
        <div className="flex flex-wrap gap-3">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={global || roles.includes(r)}
                onChange={() => toggleRole(r)}
                className="accent-portal-accent"
              />
              <span className="text-sm text-gray-800 dark:text-zinc-200">{t(`admin.user_table.role_${r}`, { defaultValue: r })}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={save} disabled={saving} className="btn-primary">
          {saving ? t('two_factor.policy.saving') : t('two_factor.policy.save')}
        </button>
        {saved && <span className="text-xs text-portal-success">{t('two_factor.policy.saved')}</span>}
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
