// p3portal.org
// PROJ-57: Footer-Upload-Sektion im HelpSlideOver.
// Zeigt Upload-Button + Sprach-Dropdown + Pflicht-Checkbox (AC-UPLOAD-10).
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUploadOverride } from '../hooks'
import { isValidHelpKey } from '../registry'

export default function HelpUploadSection({ helpKey, currentLang, onUploaded }) {
  const { t } = useTranslation()
  const [lang, setLang] = useState(currentLang || 'de')
  const [consent, setConsent] = useState(false)
  const [consentMissing, setConsentMissing] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef(null)
  const checkboxRef = useRef(null)
  const upload = useUploadOverride()

  const isKeyValid = isValidHelpKey(helpKey)

  const handleUploadClick = () => {
    if (!consent) {
      setConsentMissing(true)
      checkboxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      return
    }
    setConsentMissing(false)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setSuccess(false)

    // Client-seitige Validierung
    if (file.size > 200 * 1024) {
      setError(t('help.upload.error_too_large'))
      e.target.value = ''
      return
    }
    if (!file.name.match(/\.(md|markdown)$/i)) {
      setError(t('help.upload.error_wrong_ext'))
      e.target.value = ''
      return
    }

    try {
      await upload.mutateAsync({ key: helpKey, lang, file, consent })
      setSuccess(true)
      setConsent(false)
      setConsentMissing(false)
      e.target.value = ''
      onUploaded?.()
    } catch (err) {
      const msg = err?.response?.data?.detail
      setError(typeof msg === 'string' ? msg : t('help.upload.error_generic'))
    }
  }

  if (!isKeyValid) return null

  return (
    <div className="border-t border-gray-100 dark:border-zinc-800 pt-3 mt-3 space-y-2">
      <p className="text-xs font-medium text-gray-600 dark:text-zinc-400">{t('help.upload.title')}</p>

      {/* Sprach-Dropdown */}
      <div className="flex items-center gap-2">
        <select
          value={lang}
          onChange={e => setLang(e.target.value)}
          className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-700 dark:text-zinc-300 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
        <span className="text-xs text-gray-400 dark:text-zinc-500">{t('help.upload.size_limit')}</span>
      </div>

      {/* Pflicht-Checkbox AC-UPLOAD-10 */}
      <label
        ref={checkboxRef}
        className={`flex items-start gap-2 cursor-pointer rounded p-1 -m-1 transition-colors ${consentMissing ? 'bg-portal-danger/10 ring-1 ring-portal-danger/40' : ''}`}
      >
        <input
          type="checkbox"
          checked={consent}
          onChange={e => { setConsent(e.target.checked); setConsentMissing(false) }}
          className="mt-0.5 accent-[var(--accent)] shrink-0"
        />
        <span className="text-xs text-gray-500 dark:text-zinc-500 leading-snug">
          {t('help.upload.consent_label')}
        </span>
      </label>
      {consentMissing && (
        <p className="text-xs text-portal-danger">{t('help.upload.error_consent_required')}</p>
      )}

      {/* Upload-Button */}
      <button
        type="button"
        disabled={upload.isPending}
        onClick={handleUploadClick}
        className="btn-secondary text-xs disabled:opacity-50"
      >
        {upload.isPending ? t('help.upload.uploading') : t('help.upload.button_label')}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Feedback */}
      {error && (
        <p className="text-xs text-portal-danger">{error}</p>
      )}
      {success && (
        <p className="text-xs text-portal-success">{t('help.upload.success')}</p>
      )}
    </div>
  )
}
