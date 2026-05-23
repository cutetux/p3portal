// p3portal.org
// PROJ-48: "Eigentum übernehmen" Button – bis PROJ-50 nur für Admins sichtbar (AC-ADOPT-2).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../../../components/common/ConfirmModal'

export default function AdoptButton({ onAdopt, hasOwners }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)

  // Nicht rendern wenn Ressource bereits Owner hat (EC-7)
  if (hasOwners) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="btn-table"
      >
        {t('owners.adopt_btn')}
      </button>
      {confirm && (
        <ConfirmModal
          title={t('owners.adopt_confirm_title')}
          body={t('owners.adopt_confirm_body')}
          confirmLabel={t('owners.adopt_confirm_yes')}
          variant="primary"
          onConfirm={onAdopt}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  )
}
