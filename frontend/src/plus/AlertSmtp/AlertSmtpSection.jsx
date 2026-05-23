// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { getSmtpConfig, updateSmtpConfig } from '../../api/alerts'
import { formatApiError } from '../../api/errors'
import PlusBadge from '../../components/common/PlusBadge'

const inputCls = "w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"

const EMPTY = {
  host: '',
  port: 587,
  username: '',
  password: '',
  use_tls: true,
  from_address: '',
}

export default function AlertSmtpSection() {
  const [form, setForm] = useState(EMPTY)
  const [configured, setConfigured] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const cfg = await getSmtpConfig()
      setConfigured(cfg.configured ?? false)
      setForm({
        host: cfg.host ?? '',
        port: cfg.port ?? 587,
        username: cfg.username ?? '',
        password: '',
        use_tls: cfg.use_tls ?? true,
        from_address: cfg.from_address ?? '',
      })
    } catch (err) {
      const status = err?.response?.status
      if (status !== 403) setError('SMTP-Konfiguration konnte nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const payload = {
        host: form.host.trim() || null,
        port: Number(form.port) || null,
        username: form.username.trim() || null,
        use_tls: form.use_tls,
        from_address: form.from_address.trim() || null,
      }
      if (form.password) payload.password = form.password
      await updateSmtpConfig(payload)
      setSuccess(true)
      setForm(f => ({ ...f, password: '' }))
      await load()
    } catch (err) {
      setError(formatApiError(err, 'Speichern fehlgeschlagen.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100 flex items-center">
          E-Mail / SMTP <PlusBadge />
        </h3>
        <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
          SMTP-Konfiguration für Alert-Benachrichtigungen per E-Mail.
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse h-48 bg-gray-100 dark:bg-zinc-800 rounded" />
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {error && (
            <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-400 rounded">
              {typeof error === 'string' ? error : JSON.stringify(error)}
            </div>
          )}
          {success && (
            <div className="border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 px-3 py-2 text-xs text-green-700 dark:text-green-400 rounded">
              SMTP-Konfiguration gespeichert.
            </div>
          )}

          {configured && (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              SMTP ist konfiguriert
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">SMTP-Host</label>
              <input className={inputCls} value={form.host} onChange={e => set('host', e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Port</label>
              <input type="number" className={inputCls} value={form.port} onChange={e => set('port', e.target.value)} min={1} max={65535} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Benutzername</label>
              <input className={inputCls} value={form.username} onChange={e => set('username', e.target.value)} placeholder="user@example.com" autoComplete="off" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                Passwort {configured && <span className="text-gray-400">(leer = unverändert)</span>}
              </label>
              <input type="password" className={inputCls} value={form.password} onChange={e => set('password', e.target.value)} placeholder={configured ? '••••••••' : 'SMTP-Passwort'} autoComplete="new-password" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Absender-Adresse</label>
            <input className={inputCls} value={form.from_address} onChange={e => set('from_address', e.target.value)} placeholder="alerts@example.com" type="email" />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" className="w-4 h-4 rounded border-gray-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-500"
              checked={form.use_tls} onChange={e => set('use_tls', e.target.checked)} />
            TLS verwenden
          </label>

          <div className="flex justify-end">
            <button type="submit" disabled={saving}
              className="btn-primary">
              {saving ? 'Speichern…' : 'SMTP speichern'}
            </button>
          </div>
        </form>
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
