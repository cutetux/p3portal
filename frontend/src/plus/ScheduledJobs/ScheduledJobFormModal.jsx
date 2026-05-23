// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect } from 'react'
import { getPlaybooks } from '../../api/playbooks'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'
import PlaybookFormField from '../../components/playbooks/PlaybookFormField'
import SshJobForm from './SshJobForm'
import PowerActionJobForm from './PowerActionJobForm'
import CronPicker, { parseCronToState } from './CronPicker'
import { createScheduledJob, updateScheduledJob } from '../../api/scheduledJobs'

const inputCls = 'w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-orange-500 placeholder-gray-400 dark:placeholder-zinc-500'

function defaultConfig(type) {
  if (type === 'ssh') return { user_host: '', command: '', ssh_key_source: 'system', timeout: 30 }
  if (type === 'power_action') return { node: '', vmid: '', vmtype: 'qemu', action: 'start' }
  return {}
}

function PlaybookJobForm({ playbookName, values, onChange, onPlaybookChange, playbooks, loading }) {
  const pb = playbooks.find(p => p.name === playbookName)
  const parameters = pb?.parameters ?? []

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
          Playbook <span className="text-red-500">*</span>
        </label>
        {loading ? (
          <div className={`${inputCls} text-gray-400 dark:text-zinc-500`}>Lädt Playbooks…</div>
        ) : (
          <select value={playbookName ?? ''} onChange={e => onPlaybookChange(e.target.value)} className={inputCls}>
            <option value="">– Playbook wählen –</option>
            {playbooks.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        )}
      </div>

      {parameters.length > 0 && (
        <div className="space-y-3 border-t border-gray-100 dark:border-zinc-800 pt-3">
          <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Parameter</p>
          {parameters.map(param => (
            <PlaybookFormField
              key={param.id}
              param={param}
              value={values[param.id] ?? param.default ?? ''}
              onChange={(id, val) => onChange(id, val)}
              error={null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ScheduledJobFormModal({ job, onClose, onSaved, currentCount, maxJobs }) {
  const isEdit = !!job

  // Step: 1 = Typ, 2 = Typ-Formular, 3 = Zeitplan + Meta
  const [step, setStep] = useState(isEdit ? 2 : 1)
  const [jobType, setJobType] = useState(job?.job_type ?? '')
  const [name, setName] = useState(job?.name ?? '')
  const [description, setDescription] = useState(job?.description ?? '')
  const [active, setActive] = useState(job?.active ?? true)

  // Cron – verwaltet durch CronPicker; Window-Start = cronValue, Window-Stop = windowStopCron
  const [cronValue, setCronValue] = useState(job?.cron_expression ?? '0 8 * * *')
  const [windowStopCron, setWindowStopCron] = useState(job?.child_job?.cron_expression ?? '')

  // SSH config
  const [sshConfig, setSshConfig] = useState(
    job?.job_type === 'ssh' ? (job.config ?? {}) : defaultConfig('ssh')
  )

  // Power Action config
  const [powerConfig, setPowerConfig] = useState(
    job?.job_type === 'power_action' ? (job.config ?? {}) : defaultConfig('power_action')
  )
  const [windowMode, setWindowMode] = useState(!!job?.child_job)

  // Playbook config
  const [playbooks, setPlaybooks] = useState([])
  const [loadingPb, setLoadingPb] = useState(false)
  const [playbookName, setPlaybookName] = useState(job?.config?.playbook ?? '')
  const [pbParams, setPbParams] = useState(job?.config?.params ?? {})

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Playbooks laden wenn Typ = playbook
  useEffect(() => {
    if (jobType !== 'playbook') return
    setLoadingPb(true)
    getPlaybooks().then(setPlaybooks).catch(() => {}).finally(() => setLoadingPb(false))
  }, [jobType])

  const handleWindowMode = (enabled) => {
    setWindowMode(enabled)
    if (enabled) {
      // Cron auf täglich normalisieren, damit der Uhrzeit-Picker greift
      const s = parseCronToState(cronValue)
      if (s.type !== 'daily') {
        const t = (s.type === 'weekly') ? s.time : '08:00'
        const [h, m] = t.split(':').map(n => parseInt(n) || 0)
        setCronValue(`${m} ${h} * * *`)
      }
      // Stop-Cron mit Standardwert befüllen falls leer
      if (!windowStopCron) setWindowStopCron('0 20 * * *')
    }
  }

  const handlePlaybookChange = (pbName) => {
    setPlaybookName(pbName)
    const pb = playbooks.find(p => p.name === pbName)
    if (pb) {
      const defaults = Object.fromEntries((pb.parameters ?? []).map(p => [p.id, p.default ?? '']))
      setPbParams(defaults)
    } else {
      setPbParams({})
    }
  }

  const buildPayload = () => {
    let config = {}
    if (jobType === 'ssh') config = sshConfig
    if (jobType === 'power_action') config = powerConfig
    if (jobType === 'playbook') config = { playbook: playbookName, params: pbParams }

    const base = {
      name: name.trim(),
      description: description.trim() || null,
      job_type: jobType,
      cron_expression: cronValue,
      active,
      config,
    }
    if (jobType === 'power_action' && windowMode) {
      return {
        ...base,
        window_mode: true,
        window_stop_cron: windowStopCron,
        window_stop_config: { ...powerConfig, action: 'stop' },
      }
    }
    return base
  }

  const validate = () => {
    if (!name.trim()) return 'Name ist erforderlich.'
    if (!cronValue.trim()) return 'Zeitplan ist erforderlich.'
    if (jobType === 'ssh') {
      if (!sshConfig.user_host?.trim()) return 'Ziel (user@host) ist erforderlich.'
      if (!sshConfig.command?.trim()) return 'Befehl ist erforderlich.'
      if (!/^[^@]+@[^@]+$/.test(sshConfig.user_host.trim())) return 'Format: user@host'
    }
    if (jobType === 'power_action') {
      if (!powerConfig.node) return 'Node ist erforderlich.'
      if (!powerConfig.vmid) return 'VM/LXC ist erforderlich.'
      if (windowMode && !windowStopCron?.trim()) return 'Stoppzeit ist erforderlich.'
    }
    if (jobType === 'playbook' && !playbookName) return 'Playbook ist erforderlich.'
    return null
  }

  const handleSave = async () => {
    const err = validate()
    if (err) { setError(err); return }
    setSaving(true); setError('')
    try {
      const payload = buildPayload()
      if (isEdit) {
        await updateScheduledJob(job.id, payload)
      } else {
        await createScheduledJob(payload)
      }
      onSaved()
    } catch (e) {
      setError(e?.response?.data?.detail ?? 'Fehler beim Speichern.')
    } finally {
      setSaving(false)
    }
  }

  const TYPE_CARDS = [
    {
      value: 'playbook',
      title: 'Ansible Playbook',
      desc: 'Vorhandenes Playbook aus dem Portal auf Zeitplan ausführen.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-6 h-6">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      value: 'ssh',
      title: 'SSH-Befehl',
      desc: 'Direkten SSH-Befehl auf einem Remote-Host ausführen.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-6 h-6">
          <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      ),
    },
    {
      value: 'power_action',
      title: 'VM/LXC Power-Aktion',
      desc: 'Proxmox VM oder LXC Container starten, stoppen oder neustarten.',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-6 h-6">
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      ),
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                {isEdit ? 'Job bearbeiten' : 'Neuer Scheduled Job'}
              </h2>
              {!isEdit && (
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                  Schritt {step} von 3
                </p>
              )}
            </div>
            {!isEdit && maxJobs != null && (
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                currentCount >= maxJobs
                  ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
              }`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 shrink-0">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {currentCount} / {maxJobs} Jobs
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.scheduled_job" />
            <button onClick={onClose} className="btn-ghost transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Schritt 1: Typ-Auswahl */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-zinc-400">Welchen Job-Typ möchtest du anlegen?</p>
              {TYPE_CARDS.map(card => (
                <button
                  key={card.value}
                  onClick={() => { setJobType(card.value); setStep(2) }}
                  className="w-full flex items-start gap-4 p-4 border rounded-lg border-gray-200 dark:border-zinc-700 hover:border-orange-400 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/20 transition-colors text-left"
                >
                  <span className="text-orange-600 dark:text-orange-400 shrink-0 mt-0.5">{card.icon}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{card.title}</p>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{card.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Schritt 2: Typ-spezifisches Formular */}
          {step === 2 && (
            <div className="space-y-4">
              {!isEdit && (
                <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-zinc-500">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    jobType === 'playbook' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' :
                    jobType === 'ssh'      ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' :
                    'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                  }`}>
                    {jobType === 'playbook' ? 'Ansible Playbook' : jobType === 'ssh' ? 'SSH-Befehl' : 'Power-Aktion'}
                  </span>
                  <button onClick={() => setStep(1)} className="hover:text-gray-600 dark:hover:text-zinc-200 underline">ändern</button>
                </div>
              )}

              {jobType === 'playbook' && (
                <PlaybookJobForm
                  playbookName={playbookName}
                  values={pbParams}
                  onChange={(id, val) => setPbParams(p => ({ ...p, [id]: val }))}
                  onPlaybookChange={handlePlaybookChange}
                  playbooks={playbooks}
                  loading={loadingPb}
                />
              )}
              {jobType === 'ssh' && (
                <SshJobForm config={sshConfig} onChange={setSshConfig} />
              )}
              {jobType === 'power_action' && (
                <PowerActionJobForm
                  config={powerConfig}
                  onChange={setPowerConfig}
                  windowMode={windowMode}
                  onWindowModeChange={handleWindowMode}
                  windowStartCron={cronValue}
                  onWindowStartCronChange={setCronValue}
                  windowStopCron={windowStopCron}
                  onWindowStopCronChange={setWindowStopCron}
                />
              )}
            </div>
          )}

          {/* Schritt 3: Zeitplan + Meta */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Täglicher Patch-Check"
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  Beschreibung (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Kurze Beschreibung…"
                  className={inputCls}
                />
              </div>

              {/* Zeitplan: CronPicker für normale Jobs; Hinweis für Betriebsfenster */}
              {!windowMode ? (
                <CronPicker value={cronValue} onChange={setCronValue} label="Zeitplan" />
              ) : (
                <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/50 rounded-lg px-4 py-3 text-xs text-orange-700 dark:text-orange-400">
                  Start- und Stoppzeit wurden in Schritt 2 (Betriebsfenster) festgelegt.
                </div>
              )}

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="active-toggle"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-500"
                />
                <label htmlFor="active-toggle" className="text-sm text-gray-700 dark:text-zinc-300">
                  Job sofort aktivieren
                </label>
              </div>
            </div>
          )}

          {/* Beim Bearbeiten: alle Felder auf einer Seite */}
          {isEdit && step === 2 && (
            <div className="space-y-4 border-t border-gray-100 dark:border-zinc-800 pt-4">
              <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Zeitplan &amp; Allgemein</p>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                  Beschreibung (optional)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Im Edit-Modus: CronPicker nur wenn kein Betriebsfenster */}
              {!windowMode ? (
                <CronPicker value={cronValue} onChange={setCronValue} label="Zeitplan" />
              ) : (
                <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800/50 rounded-lg px-4 py-3 text-xs text-orange-700 dark:text-orange-400">
                  Start- und Stoppzeit werden im Betriebsfenster-Abschnitt oben konfiguriert.
                </div>
              )}

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="active-toggle-edit"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-zinc-600 text-orange-500 focus:ring-orange-500"
                />
                <label htmlFor="active-toggle-edit" className="text-sm text-gray-700 dark:text-zinc-300">
                  Job aktiv
                </label>
              </div>
            </div>
          )}

          {error && (
            <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-400 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 dark:border-zinc-800 shrink-0">
          {step === 1 && (
            <button onClick={onClose} className="btn-secondary">Abbrechen</button>
          )}
          {step === 2 && !isEdit && (
            <>
              <button onClick={() => setStep(1)} className="btn-secondary">Zurück</button>
              <button onClick={() => setStep(3)} className="btn-primary">Weiter</button>
            </>
          )}
          {step === 3 && !isEdit && (
            <>
              <button onClick={() => setStep(2)} className="btn-secondary">Zurück</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Speichert…' : 'Job erstellen'}
              </button>
            </>
          )}
          {isEdit && step === 2 && (
            <>
              <button onClick={onClose} className="btn-secondary">Abbrechen</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Speichert…' : 'Änderungen speichern'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
