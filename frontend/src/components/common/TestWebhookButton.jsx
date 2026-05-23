// p3portal.org
import { useState } from 'react'
import { testWebhook } from '../../api/alerts'
import { formatApiError } from '../../api/errors'

// ── Shared webhook-receiver metadata ─────────────────────────────────────────

/** All supported receiver types with their UI metadata. */
export const WEBHOOK_RECEIVERS = [
  { value: 'custom',      label: 'Benutzerdefiniert (Webhook)' },
  { value: 'gotify',      label: 'Gotify' },
  { value: 'ntfy',        label: 'Ntfy' },
  { value: 'slack',       label: 'Slack' },
  { value: 'discord',     label: 'Discord' },
  { value: 'mattermost',  label: 'Mattermost' },
]

/** URL field label per receiver type. */
export const WEBHOOK_URL_LABELS = {
  custom:     'Webhook-URL',
  gotify:     'Gotify-Server-URL',
  ntfy:       'Ntfy-Topic-URL',
  slack:      'Slack Webhook-URL',
  discord:    'Discord Webhook-URL',
  mattermost: 'Mattermost Webhook-URL',
}

/** URL input placeholder per receiver type. */
export const WEBHOOK_URL_PLACEHOLDERS = {
  custom:     'https://hooks.example.com/...',
  gotify:     'https://gotify.example.com',
  ntfy:       'https://ntfy.sh/mein-topic',
  slack:      'https://hooks.slack.com/services/T.../B.../...',
  discord:    'https://discord.com/api/webhooks/1234/abcd...',
  mattermost: 'https://mattermost.example.com/hooks/...',
}

/** Token field label per receiver type (only for types that have one). */
export const WEBHOOK_TOKEN_LABELS = {
  custom:  'Webhook-Token (Bearer)',
  gotify:  'App-Token',
  ntfy:    'Access-Token (optional)',
}

/** Token input placeholder per receiver type. */
export const WEBHOOK_TOKEN_PLACEHOLDERS = {
  custom:  'Nur für Header-Auth (n8n, Pushover, eigene Bridges)',
  gotify:  'Gotify App-Token',
  ntfy:    'Für private Topics (leer = öffentlicher Topic)',
}

/**
 * Receiver types where the token is embedded in the webhook URL itself
 * (no separate token field needed).
 */
export const WEBHOOK_TOKEN_IN_URL = ['slack', 'discord', 'mattermost']

// ── Legacy auto-detection (backward-compat for old stored full-path Gotify URLs) ─

// Mirrors backend _is_gotify_url() so we can show a hint before sending.
export function detectWebhookAdapter(url) {
  const u = (url || '').trim()
  if (!u) return null
  try {
    const parsed = new URL(u)
    const pathEndsMessage = parsed.pathname.replace(/\/+$/, '').endsWith('/message')
    const hasToken = parsed.searchParams.has('token')
    if (pathEndsMessage && hasToken) return 'gotify'
  } catch {
    return null
  }
  return null
}

/**
 * Test-Notify-Button for webhook URL fields. Sends a real alert payload with
 * ``test=true`` to the URL currently typed in the form (not the saved value),
 * including the optional Bearer token. Shows status inline.
 *
 * Props:
 *  - url      string  : current webhook URL value (required for enabled state)
 *  - token    string? : current Bearer token value (optional, '' = none)
 *  - size     'sm' | 'md' (default 'sm')
 *  - className optional extra classes for the outer wrapper
 */
export default function TestWebhookButton({ url, token, receiverType = 'custom', ruleId = null, size = 'sm', className = '' }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const trimmedUrl = (url || '').trim()
  const disabled = busy || !trimmedUrl

  const onClick = async () => {
    setBusy(true)
    setResult(null)
    try {
      const data = await testWebhook(trimmedUrl, token || '', receiverType, ruleId)
      setResult({
        ok: !!data.ok,
        status: data.status_code,
        body: data.body_preview || '',
        error: data.error || null,
        adapter: data.adapter || null,
      })
    } catch (err) {
      setResult({ ok: false, status: null, body: '', error: formatApiError(err, 'Test fehlgeschlagen.') })
    } finally {
      setBusy(false)
    }
  }

  const sizeCls = size === 'md' ? 'text-sm px-3 py-2' : 'text-xs px-2.5 py-1.5'

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`btn-secondary ${sizeCls}`}
        title={trimmedUrl ? 'Test-Benachrichtigung an Webhook senden' : 'Webhook-URL eingeben'}
      >
        {busy ? 'Sende…' : 'Test senden'}
      </button>

      {result && (
        <p
          className={`mt-1 text-xs ${result.ok ? 'text-portal-success' : 'text-portal-danger'}`}
          role="status"
        >
          {result.ok ? (
            <>HTTP {result.status} – Test erfolgreich gesendet{result.adapter && result.adapter !== 'native' ? ` (${result.adapter})` : ''}.</>
          ) : result.error ? (
            <>Fehler: {result.error}</>
          ) : (
            <>HTTP {result.status ?? '?'} – Empfänger hat den Test abgelehnt.{result.body ? ` ${result.body}` : ''}</>
          )}
        </p>
      )}
    </div>
  )
}
