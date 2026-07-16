// p3portal.org
// PROJ-106: Zwei-Faktor-Authentifizierung – Enrollment-Assistent, Status & Deaktivierung.
// Wiederverwendet in SecurityTab (Profil) und Setup2faPage (Zwangs-Enrollment).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { get2faStatus, setup2fa, verify2fa, disable2fa, regenerateRecoveryCodes } from '../../api/twoFactor'

const inputCls =
  'w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 ' +
  'text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm ' +
  'focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent transition'

function RecoveryCodes({ codes }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const text = codes.join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard evtl. blockiert – Download bleibt */ }
  }

  const download = () => {
    const blob = new Blob([text + '\n'], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'p3-portal-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="bg-portal-warn/10 border border-portal-warn/30 px-3 py-2 mb-3">
        <p className="text-sm text-portal-warn">{t('two_factor.recovery.notice')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c} className="text-gray-900 dark:text-zinc-100">{c}</span>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button type="button" onClick={copy} className="btn-secondary">
          {copied ? t('two_factor.recovery.copied') : t('two_factor.recovery.copy')}
        </button>
        <button type="button" onClick={download} className="btn-secondary">
          {t('two_factor.recovery.download')}
        </button>
      </div>
    </div>
  )
}

export default function TwoFactorSection({ forced = false, onTokenRefresh, onDone }) {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null)   // { enabled, pending, enforced }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Enrollment-Schritte: 'idle' | 'enrolling' | 'recovery'
  const [step, setStep] = useState('idle')
  const [setupData, setSetupData] = useState(null) // { secret, otpauth_uri, qr_svg }
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState([])
  const [recoveryMode, setRecoveryMode] = useState('enroll') // 'enroll' | 'regenerate'

  // Deaktivierung
  const [disableOpen, setDisableOpen] = useState(false)
  const [disableInput, setDisableInput] = useState('')
  const [showDisableInput, setShowDisableInput] = useState(false)

  const loadStatus = async () => {
    setLoading(true)
    try {
      setStatus(await get2faStatus())
    } catch {
      setError(t('two_factor.err_load'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startEnroll = async () => {
    setError('')
    setBusy(true)
    try {
      setSetupData(await setup2fa())
      setStep('enrolling')
      setCode('')
    } catch {
      setError(t('two_factor.err_setup'))
    } finally {
      setBusy(false)
    }
  }

  const submitVerify = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await verify2fa(code.trim())
      // Frisches Token übernehmen (entfernt must_setup_2fa) und Recovery-Codes zeigen.
      if (res.access_token && onTokenRefresh) onTokenRefresh(res.access_token)
      setRecoveryCodes(res.recovery_codes || [])
      setRecoveryMode('enroll')
      setStep('recovery')
    } catch (err) {
      setError(err.response?.status === 400 ? t('two_factor.err_code') : t('two_factor.err_verify'))
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async () => {
    setError('')
    setBusy(true)
    try {
      const res = await regenerateRecoveryCodes()
      setRecoveryCodes(res.recovery_codes || [])
      setRecoveryMode('regenerate')
      setStep('recovery')
    } catch {
      setError(t('two_factor.err_regenerate'))
    } finally {
      setBusy(false)
    }
  }

  const finishRecovery = async () => {
    setSetupData(null)
    setRecoveryCodes([])
    setCode('')
    setStep('idle')
    if (forced && onDone) { onDone(); return }
    await loadStatus()
  }

  const cancelEnroll = () => {
    setStep('idle')
    setSetupData(null)
    setCode('')
    setError('')
  }

  const submitDisable = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      // Eingabe kann TOTP-Code (Ziffern) oder Passwort sein.
      const val = disableInput.trim()
      const isCode = /^\d{6,8}$/.test(val)
      await disable2fa(isCode ? { code: val } : { password: val })
      setDisableOpen(false)
      setDisableInput('')
      setShowDisableInput(false)
      await loadStatus()
    } catch (err) {
      if (err.response?.status === 403) setError(t('two_factor.disable.err_enforced'))
      else setError(t('two_factor.disable.err_confirm'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-500 dark:text-zinc-500">{t('two_factor.loading')}</p>
  }

  const errorBanner = error && (
    <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 mb-3">{error}</p>
  )

  // ── Enrollment-Assistent ─────────────────────────────────────────────────────
  if (step === 'enrolling' && setupData) {
    return (
      <div>
        {errorBanner}
        <p className="text-sm text-gray-600 dark:text-zinc-400 mb-3">{t('two_factor.enroll.step1')}</p>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div
            className="bg-white p-3 rounded border border-gray-200 w-44 h-44 shrink-0 [&>svg]:w-full [&>svg]:h-full"
            dangerouslySetInnerHTML={{ __html: setupData.qr_svg }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-1">{t('two_factor.enroll.manual_key')}</p>
            <code className="block break-all text-sm bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded px-2 py-1.5 text-gray-900 dark:text-zinc-100">
              {setupData.secret}
            </code>
          </div>
        </div>
        <form onSubmit={submitVerify} className="mt-4 space-y-3 max-w-xs">
          <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider">
            {t('two_factor.enroll.enter_code')}
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000000"
            autoFocus
            className={inputCls}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !code.trim()} className="btn-primary">
              {busy ? t('two_factor.enroll.verifying') : t('two_factor.enroll.activate')}
            </button>
            <button type="button" onClick={cancelEnroll} className="btn-secondary">{t('common.cancel')}</button>
          </div>
        </form>
      </div>
    )
  }

  if (step === 'recovery') {
    return (
      <div>
        <p className="text-sm text-portal-success bg-portal-success/10 border border-portal-success/30 px-3 py-2 mb-3">
          {recoveryMode === 'regenerate' ? t('two_factor.recovery.regenerated') : t('two_factor.enroll.activated')}
        </p>
        <RecoveryCodes codes={recoveryCodes} />
        <button type="button" onClick={finishRecovery} className="btn-primary mt-4">
          {t('two_factor.recovery.done')}
        </button>
      </div>
    )
  }

  // ── Status-Ansicht ───────────────────────────────────────────────────────────
  return (
    <div>
      {errorBanner}
      {status?.enabled ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block px-2 py-0.5 text-xs bg-portal-success/10 text-portal-success border border-portal-success/30">
              {t('two_factor.status.active')}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-zinc-400 mb-3">{t('two_factor.status.active_desc')}</p>
          <div className="mb-3">
            <button type="button" onClick={regenerate} disabled={busy} className="btn-secondary">
              {busy ? t('two_factor.recovery.regenerating') : t('two_factor.recovery.regenerate_btn')}
            </button>
          </div>
          {status.enforced ? (
            <p className="text-xs text-gray-500 dark:text-zinc-500">{t('two_factor.status.enforced_hint')}</p>
          ) : !disableOpen ? (
            <button type="button" onClick={() => { setError(''); setDisableOpen(true) }} className="btn-danger">
              {t('two_factor.disable.btn')}
            </button>
          ) : (
            <form onSubmit={submitDisable} className="space-y-2 max-w-xs">
              <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider">
                {t('two_factor.disable.confirm_label')}
              </label>
              <div className="relative">
                <input
                  type={showDisableInput ? 'text' : 'password'}
                  value={disableInput}
                  onChange={(e) => setDisableInput(e.target.value)}
                  placeholder={t('two_factor.disable.confirm_placeholder')}
                  autoFocus
                  autoComplete="off"
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowDisableInput(v => !v)}
                  className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
                  tabIndex={-1}
                  aria-label={showDisableInput ? t('two_factor.disable.hide') : t('two_factor.disable.show')}
                >
                  {showDisableInput ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || !disableInput.trim()} className="btn-danger">
                  {busy ? t('two_factor.disable.disabling') : t('two_factor.disable.confirm')}
                </button>
                <button type="button" onClick={() => { setDisableOpen(false); setDisableInput(''); setShowDisableInput(false) }} className="btn-secondary">
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-block px-2 py-0.5 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500 border border-zinc-300 dark:border-zinc-700">
              {t('two_factor.status.inactive')}
            </span>
            {status?.enforced && (
              <span className="inline-block px-2 py-0.5 text-xs bg-portal-warn/10 text-portal-warn border border-portal-warn/30">
                {t('two_factor.status.required')}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-zinc-400 mb-3">{t('two_factor.status.inactive_desc')}</p>
          <button type="button" onClick={startEnroll} disabled={busy} className="btn-primary">
            {busy ? t('two_factor.enroll.starting') : t('two_factor.enroll.btn_setup')}
          </button>
        </>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
