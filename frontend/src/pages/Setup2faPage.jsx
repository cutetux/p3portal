// p3portal.org
// PROJ-106: Zwangs-Enrollment – Enforce-pflichtiger Nutzer ohne eingerichtetes 2FA.
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import TwoFactorSection from '../components/profile/TwoFactorSection'

export default function Setup2faPage() {
  const { t } = useTranslation()
  const { updateToken, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-zinc-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-gray-900 dark:text-zinc-100 tracking-tight uppercase">P3 Portal</h1>
          <p className="text-gray-500 dark:text-zinc-500 text-sm mt-1">{t('two_factor.setup_page.subtitle')}</p>
        </div>

        <div className="bg-portal-warn/10 border border-portal-warn/30 px-4 py-3 mb-4">
          <p className="text-sm text-portal-warn">{t('two_factor.setup_page.notice')}</p>
        </div>

        <div className="bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-lg p-6">
          <TwoFactorSection
            forced
            onTokenRefresh={updateToken}
            onDone={() => navigate('/dashboard')}
          />
        </div>

        <div className="text-center mt-4">
          <button type="button" onClick={handleLogout} className="btn-secondary">
            {t('two_factor.setup_page.logout')}
          </button>
        </div>
        <p className="text-center text-xs text-gray-400 dark:text-zinc-700 mt-6">p3portal.org</p>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
