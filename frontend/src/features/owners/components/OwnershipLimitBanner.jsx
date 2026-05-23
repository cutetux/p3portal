// p3portal.org
// PROJ-48: Banner im Deploy-Formular wenn Owner-Limit erreicht (AC-EDIT-3).
import { useTranslation } from 'react-i18next'

export default function OwnershipLimitBanner({ current, max }) {
  const { t } = useTranslation()
  if (!max || current < max) return null
  return (
    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
      <span className="font-medium">{t('owners.limit_banner_title', { current, max })}</span>
      {' '}
      {t('owners.limit_banner_hint')}
    </div>
  )
}
