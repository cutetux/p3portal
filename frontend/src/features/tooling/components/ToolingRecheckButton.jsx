// p3portal.org
// PROJ-66: Slide-Over Body §4 — „Jetzt prüfen"-Button mit Rate-Limit-State (AC-SLIDE-3/4/5)
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useToolingRecheck } from '../hooks'

export default function ToolingRecheckButton() {
  const { t } = useTranslation()
  const mutation = useToolingRecheck()
  const [retryAfter, setRetryAfter] = useState(0)

  // Countdown für Rate-Limit (AC-SLIDE-5)
  useEffect(() => {
    if (retryAfter <= 0) return
    const timer = setInterval(() => {
      setRetryAfter(v => {
        if (v <= 1) { clearInterval(timer); return 0 }
        return v - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [retryAfter])

  const handleRecheck = async () => {
    try {
      await mutation.mutateAsync()
    } catch (err) {
      const status = err?.response?.status
      if (status === 429) {
        const ra = parseInt(err?.response?.headers?.['retry-after'] ?? '30', 10)
        setRetryAfter(isNaN(ra) ? 30 : ra)
      }
    }
  }

  const busy = mutation.isPending
  const limited = retryAfter > 0

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <button
        type="button"
        onClick={handleRecheck}
        disabled={busy || limited}
        className="btn-primary"
      >
        {busy
          ? t('tooling.recheck_busy')
          : limited
          ? t('tooling.recheck_rate_limited', { seconds: retryAfter })
          : t('tooling.recheck_button')}
      </button>
      {mutation.isSuccess && !busy && !limited && (
        <span className="text-xs text-portal-success">{t('tooling.recheck_done')}</span>
      )}
    </div>
  )
}
