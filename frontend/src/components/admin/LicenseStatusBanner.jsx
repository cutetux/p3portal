// p3portal.org
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getLicenseStatus } from '../../api/license'

function LockClosed({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="9" width="12" height="10" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function LockOpen({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="9" width="12" height="10" rx="2" />
      {/* shackle open: right side still in body, left side lifted */}
      <path d="M7 9V6a3 3 0 0 1 5.83-1" />
      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function LicenseStatusBanner() {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)

  useEffect(() => {
    getLicenseStatus().then(setStatus).catch(() => {})
  }, [])

  if (!status) return null

  const isValid = status.valid
  const isError = !status.valid && status.reason !== 'missing'

  let colorClass, tooltip
  if (isValid) {
    colorClass = 'text-green-500'
    const parts = [status.edition === 'plus_v2' ? 'P3 Plus v2' : 'P3 Plus v1']
    if (status.contact_name) parts.push(status.contact_name)
    if (status.expiry) parts.push(t('admin.license.tooltip_valid_until', { expiry: status.expiry }))
    tooltip = parts.join(' · ')
  } else if (isError) {
    colorClass = 'text-red-500'
    tooltip =
      status.reason === 'expired'
        ? t('admin.license.tooltip_expired', { expiry: status.expiry })
        : t('admin.license.tooltip_invalid')
  } else {
    colorClass = 'text-gray-400 dark:text-zinc-500'
    tooltip = t('admin.license.tooltip_core')
  }

  return (
    <span title={tooltip} className="cursor-default" role="img" aria-label={tooltip}>
      {isValid
        ? <LockOpen  className={`w-5 h-5 ${colorClass}`} />
        : <LockClosed className={`w-5 h-5 ${colorClass}`} />
      }
    </span>
  )
}
