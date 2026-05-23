// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect } from 'react'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'
import TestWebhookButton, {
  WEBHOOK_RECEIVERS,
  WEBHOOK_URL_LABELS,
  WEBHOOK_URL_PLACEHOLDERS,
  WEBHOOK_TOKEN_LABELS,
  WEBHOOK_TOKEN_PLACEHOLDERS,
  WEBHOOK_TOKEN_IN_URL,
} from '../../components/common/TestWebhookButton'

const METRIC_OPTIONS = [
  { value: 'cpu_percent', label: 'CPU (%)' },
  { value: 'mem_percent', label: 'RAM (%)' },
  { value: 'disk_percent', label: 'Disk (%)' },
  { value: 'status', label: 'VM-Status (gestoppt)' },
]

const EMPTY_RULE = {
  name: '',
  metric: 'cpu_percent',
  warning_threshold: '',
  critical_threshold: '',
  sustained_polls: 1,
  enabled: true,
  notify_recovery: true,
  filesystem: '',
  webhook_url: '',
  webhook_token: '',
  webhook_receiver_type: 'custom',
  email_recipients: '',
}

const labelCls = "block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1"
const helpCls = "text-xs text-gray-500 dark:text-zinc-400 mt-1"
const inputCls = "w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500"
const sectionTitleCls = "text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wide"

function RuleCard({ rule, index, onChange, onRemove }) {
  const isStatus = rule.metric === 'status'
  const isDisk = rule.metric === 'disk_percent'
  const set = (key, val) => onChange(index, { ...rule, [key]: val })

  return (
    <div className="border border-gray-200 dark:border-zinc-700 rounded-lg bg-gray-50/50 dark:bg-zinc-800/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-zinc-800/70 border-b border-gray-200 dark:border-zinc-700">
        <span className="text-xs font-semibold text-gray-700 dark:text-zinc-200">
          Regel {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-xs text-red-500 hover:text-red-600 transition-colors flex items-center gap-1"
          title="Regel entfernen"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Entfernen
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className={labelCls}>
              Regelname <span className="text-red-500">*</span>
            </label>
            <input
              className={inputCls}
              value={rule.name}
              onChange={e => set('name', e.target.value)}
              placeholder="z. B. RAM-Auslastung hoch"
              required
            />
          </div>
          <div>
            <label className={labelCls}>
              Metrik <span className="text-red-500">*</span>
            </label>
            <select
              className={inputCls}
              value={rule.metric}
              onChange={e => set('metric', e.target.value)}
            >
              {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {!isStatus && (
          <div>
            <p className={sectionTitleCls + ' mb-2'}>Schwellwerte</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Warnung (%)</label>
                <input
                  type="number"
                  className={inputCls}
                  value={rule.warning_threshold}
                  onChange={e => set('warning_threshold', e.target.value)}
                  min={0} max={100} step={0.1}
                  placeholder="z. B. 80"
                />
              </div>
              <div>
                <label className={labelCls}>Kritisch (%)</label>
                <input
                  type="number"
                  className={inputCls}
                  value={rule.critical_threshold}
                  onChange={e => set('critical_threshold', e.target.value)}
                  min={0} max={100} step={0.1}
                  placeholder="z. B. 95"
                />
              </div>
            </div>
            <p className={helpCls}>
              Die Warnung-Schwelle muss kleiner sein als die kritische Schwelle.
            </p>
          </div>
        )}

        {isDisk && (
          <div>
            <label className={labelCls}>Dateisystem (optional)</label>
            <input
              className={inputCls}
              value={rule.filesystem}
              onChange={e => set('filesystem', e.target.value)}
              placeholder="z. B. / oder /data – leer = alle Mounts"
            />
            <p className={helpCls}>
              Beschränkt die Regel auf einen bestimmten Mount. Leer lassen, wenn alle Festplatten geprüft werden sollen.
            </p>
          </div>
        )}

        <div>
          <p className={sectionTitleCls + ' mb-2'}>Verhalten</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Persistenz (Polls)</label>
              <input
                type="number"
                className={inputCls}
                value={rule.sustained_polls}
                onChange={e => set('sustained_polls', e.target.value)}
                min={1} max={100}
              />
              <p className={helpCls}>
                Wie viele Poll-Zyklen in Folge die Schwelle überschritten sein muss, bevor ein Alert ausgelöst wird.
              </p>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <label className="flex items-center gap-2 px-3 py-2 border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={e => set('enabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-orange-500 focus:ring-orange-500"
                />
                <span className="text-sm text-gray-700 dark:text-zinc-200">
                  Regel aktiv
                </span>
              </label>
            </div>
          </div>
        </div>

        <div>
          <p className={sectionTitleCls + ' mb-2'}>Benachrichtigung</p>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Empfänger</label>
              <select
                className={inputCls}
                value={rule.webhook_receiver_type}
                onChange={e => set('webhook_receiver_type', e.target.value)}
              >
                {WEBHOOK_RECEIVERS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                {WEBHOOK_URL_LABELS[rule.webhook_receiver_type] ?? 'Webhook-URL'} (optional)
              </label>
              <input
                className={inputCls}
                type="url"
                value={rule.webhook_url}
                onChange={e => set('webhook_url', e.target.value)}
                placeholder={WEBHOOK_URL_PLACEHOLDERS[rule.webhook_receiver_type] ?? 'https://...'}
              />
              {rule.webhook_receiver_type === 'gotify' && rule.webhook_url && (
                <p className={helpCls + ' text-portal-info'}>
                  Sendet an: <code>{rule.webhook_url.replace(/\/$/, '')}/message?token=…</code>
                </p>
              )}
            </div>
            {WEBHOOK_TOKEN_IN_URL.includes(rule.webhook_receiver_type) ? (
              <p className={helpCls + ' text-portal-info'}>
                Token ist in der Webhook-URL enthalten – kein separates Token-Feld nötig.
              </p>
            ) : (
              <div>
                <label className={labelCls}>
                  {WEBHOOK_TOKEN_LABELS[rule.webhook_receiver_type] ?? 'Token'} (optional)
                </label>
                <input
                  className={inputCls}
                  type="password"
                  autoComplete="new-password"
                  value={rule.webhook_token}
                  onChange={e => set('webhook_token', e.target.value)}
                  placeholder={WEBHOOK_TOKEN_PLACEHOLDERS[rule.webhook_receiver_type] ?? ''}
                />
              </div>
            )}
            <TestWebhookButton url={rule.webhook_url} token={rule.webhook_token} receiverType={rule.webhook_receiver_type} ruleId={rule.id ?? null} />
            <div>
              <label className={labelCls}>E-Mail-Empfänger (optional)</label>
              <input
                className={inputCls}
                value={rule.email_recipients}
                onChange={e => set('email_recipients', e.target.value)}
                placeholder="a@example.com, b@example.com"
              />
              <p className={helpCls}>Kommagetrennte Adressen.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AlertPresetFormModal({ preset, onSave, onClose, loading, error }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState([])

  useEffect(() => {
    if (preset) {
      setName(preset.name ?? '')
      setDescription(preset.description ?? '')
      setRules((preset.rules ?? []).map(r => ({
        name: r.name ?? '',
        metric: r.metric ?? 'cpu_percent',
        warning_threshold: r.warning_threshold ?? '',
        critical_threshold: r.critical_threshold ?? '',
        sustained_polls: r.sustained_polls ?? 1,
        enabled: r.enabled ?? true,
        notify_recovery: r.notify_recovery ?? true,
        filesystem: r.filesystem ?? '',
        webhook_url: r.webhook_url ?? '',
        webhook_receiver_type: r.webhook_receiver_type ?? 'custom',
        // Server never returns webhook_token; keep blank so user must re-enter
        // to overwrite, omit when saving to keep existing token.
        webhook_token: '',
        email_recipients: r.email_recipients ?? '',
      })))
    } else {
      setName(''); setDescription(''); setRules([])
    }
  }, [preset])

  const addRule = () => setRules(r => [...r, { ...EMPTY_RULE }])
  const changeRule = (i, val) => setRules(r => r.map((x, idx) => idx === i ? val : x))
  const removeRule = (i) => setRules(r => r.filter((_, idx) => idx !== i))

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      rules: rules.map(r => {
        const out = {
          name: r.name.trim(),
          metric: r.metric,
          warning_threshold: r.metric === 'status' ? null : (r.warning_threshold !== '' ? Number(r.warning_threshold) : null),
          critical_threshold: r.critical_threshold !== '' ? Number(r.critical_threshold) : null,
          sustained_polls: Number(r.sustained_polls) || 1,
          enabled: r.enabled,
          notify_recovery: r.notify_recovery,
          filesystem: r.metric === 'disk_percent' && r.filesystem.trim() ? r.filesystem.trim() : null,
          webhook_url: r.webhook_url.trim() || null,
          webhook_receiver_type: r.webhook_receiver_type || 'custom',
          email_recipients: r.email_recipients.trim() || null,
        }
        // Only include webhook_token if the user typed something. Sending null
        // here would clear an existing token on every save.
        if (r.webhook_token && r.webhook_token.trim()) {
          out.webhook_token = r.webhook_token.trim()
        }
        return out
      }),
    }
    onSave(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
              {preset ? 'Preset bearbeiten' : 'Neues Preset'}
            </h2>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Ein Preset bündelt mehrere Alert-Regeln und kann VMs zugewiesen werden.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.alert_preset_form" />
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost transition-colors"
              aria-label="Schließen"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-400 rounded">
              {typeof error === 'string' ? error : JSON.stringify(error)}
            </div>
          )}

          <section>
            <h3 className={sectionTitleCls + ' mb-3'}>Preset-Eigenschaften</h3>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  className={inputCls}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="z. B. Web-Server Standard"
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Beschreibung (optional)</label>
                <input
                  className={inputCls}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Kurze Erklärung, wofür dieses Preset gedacht ist"
                />
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className={sectionTitleCls}>Regeln</h3>
                <p className={helpCls}>
                  Jede Regel überwacht eine Metrik mit Schwellwerten. Mindestens eine Regel ist erforderlich.
                </p>
              </div>
              {rules.length > 0 && (
                <button
                  type="button"
                  onClick={addRule}
                  className="text-xs text-orange-600 dark:text-orange-400 hover:underline transition-colors shrink-0"
                >
                  + Regel hinzufügen
                </button>
              )}
            </div>

            {rules.length === 0 ? (
              <button
                type="button"
                onClick={addRule}
                className="w-full border-2 border-dashed border-gray-300 dark:border-zinc-700 rounded-lg py-8 text-sm text-gray-500 dark:text-zinc-400 hover:border-orange-400 hover:text-orange-500 dark:hover:border-orange-500 dark:hover:text-orange-400 transition-colors flex flex-col items-center gap-2"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className="font-medium">Erste Regel hinzufügen</span>
              </button>
            ) : (
              <div className="space-y-3">
                {rules.map((r, i) => (
                  <RuleCard key={i} rule={r} index={i} onChange={changeRule} onRemove={removeRule} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 dark:border-zinc-800 shrink-0 bg-gray-50/50 dark:bg-zinc-900/80">
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            {rules.length === 0
              ? 'Keine Regeln definiert.'
              : `${rules.length} ${rules.length === 1 ? 'Regel' : 'Regeln'} definiert.`}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading || rules.length === 0}
              className="px-4 py-2 text-sm rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Speichern…' : 'Preset speichern'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
