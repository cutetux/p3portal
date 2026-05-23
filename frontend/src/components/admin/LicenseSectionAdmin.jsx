// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { getLicenseDetails, uploadLicense, deactivateLicense } from '../../api/license'

const EDITION_LABEL = { plus_v1: 'P3 Plus v1', plus_v2: 'P3 Plus v2', core: 'P3 Core', basis: 'P3 Core' }

export default function LicenseSectionAdmin() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateMsg, setDeactivateMsg] = useState(null)
  const fileInputRef = useRef(null)

  const refresh = () => {
    setLoading(true)
    getLicenseDetails()
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0] || null)
    setUploadMsg(null)
  }

  const handleDeactivate = async () => {
    if (!window.confirm(t('admin.license.deactivate_confirm'))) return
    setDeactivating(true)
    setDeactivateMsg(null)
    try {
      await deactivateLicense()
      setDeactivateMsg({ ok: true, text: t('admin.license.deactivate_success') })
      queryClient.invalidateQueries({ queryKey: ['capabilities'] })
      refresh()
    } catch {
      setDeactivateMsg({ ok: false, text: t('admin.license.deactivate_error') })
    } finally {
      setDeactivating(false)
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) return
    setUploading(true)
    setUploadMsg(null)
    try {
      await uploadLicense(selectedFile)
      setUploadMsg({ ok: true, text: t('admin.license.upload_success') })
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['capabilities'] })
      refresh()
    } catch (err) {
      if (err.response?.status === 422) {
        setUploadMsg({ ok: false, text: t('admin.license.upload_invalid') })
      } else {
        setUploadMsg({ ok: false, text: t('admin.license.upload_error') })
      }
    } finally {
      setUploading(false)
    }
  }

  const reasonLabel = (r) => {
    if (!r) return null
    return t(`admin.license.reason_${r}`, { defaultValue: r })
  }

  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-3">
        {t('admin.license.title')}
      </h2>

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800">
        {loading ? (
          <div className="px-4 py-3 text-sm text-zinc-400">{t('admin.license.loading')}</div>
        ) : !details ? (
          <div className="px-4 py-3 text-sm text-zinc-400">{t('admin.license.not_available')}</div>
        ) : (
          <>
            <Row label={t('admin.license.label_edition')}>
              <span className={`font-medium ${details.valid ? 'text-green-600 dark:text-green-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
                {EDITION_LABEL[details.edition] ?? details.edition}
              </span>
              {details.valid
                ? <span className="ml-2 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">{t('admin.license.badge_active')}</span>
                : <span className="ml-2 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 rounded-full">
                    {reasonLabel(details.reason) ?? t('admin.license.badge_invalid')}
                  </span>
              }
            </Row>

            {details.expiry && (
              <Row label={t('admin.license.label_expiry')}>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{details.expiry}</span>
              </Row>
            )}

            {details.contact_name && (
              <Row label={t('admin.license.label_holder')}>
                <span className="text-sm text-zinc-700 dark:text-zinc-300">{details.contact_name}</span>
              </Row>
            )}

            {details.contact_email && (
              <Row label={t('admin.license.label_email')}>
                <span className="text-sm font-mono text-zinc-700 dark:text-zinc-300 select-all">
                  {details.contact_email}
                </span>
              </Row>
            )}

            {details.valid && (
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 font-medium">
                    {t('admin.license.deactivate_btn')}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('admin.license.deactivate_confirm')}
                  </p>
                  {deactivateMsg && (
                    <p className={`mt-1 text-xs ${deactivateMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {deactivateMsg.text}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleDeactivate}
                  disabled={deactivating}
                  className="shrink-0 px-4 py-1.5 text-sm font-medium rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {deactivating ? t('admin.license.deactivating') : t('admin.license.deactivate_btn')}
                </button>
              </div>
            )}
          </>
        )}

        {/* Upload section */}
        <div className="px-4 py-4">
          <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('admin.license.upload_title')}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
            {t('admin.license.upload_description')}
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="cursor-pointer btn-secondary text-xs px-3 py-1.5">
              {t('admin.license.upload_select')}
              <input
                ref={fileInputRef}
                type="file"
                accept=".lic,.json"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-xs">
              {selectedFile ? selectedFile.name : t('admin.license.upload_no_file')}
            </span>
            <button
              onClick={handleUpload}
              disabled={!selectedFile || uploading}
              className="ml-auto shrink-0 btn-primary"
            >
              {uploading ? '…' : t('admin.license.upload_btn')}
            </button>
          </div>
          {uploadMsg && (
            <p className={`mt-2 text-xs ${uploadMsg.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {uploadMsg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-4">
      <span className="text-sm text-zinc-500 dark:text-zinc-400 shrink-0">{label}</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}
