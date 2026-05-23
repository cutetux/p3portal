// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Modal zum Erstellen/Bearbeiten einer Approval-Regel (Admin) – PROJ-58 portal-* Tokens.
import { useState } from 'react'
import { formatApiError } from '../../../api/errors'
import { useApprovalRules, useCreateRule, useDeleteRule, useUpdateRule, useWorkflowConfig } from '../hooks'
import { useCapability } from '../../../hooks/useCapability'
import PlusBadge from '../../../components/common/PlusBadge'

const ACTION_TYPES = [
  { value: 'playbook_run',         label: 'Playbook-Ausführung' },
  { value: 'packer_build',         label: 'Packer-Build' },
  { value: 'vm_delete',            label: 'VM löschen' },
  { value: 'lxc_delete',           label: 'LXC löschen' },
  { value: 'template_delete',      label: 'Template löschen' },
  { value: 'owner_delete_request', label: 'Owner-Löschantrag' },
  { value: 'owner_adopt_request',  label: 'VM adoptieren' },
]

const inputCls = 'w-full border border-portal-border rounded-lg px-3 py-2 text-sm bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent disabled:opacity-60'

/** @param {{ rule: object|null, onClose: Function }} */
export default function ApprovalRuleFormModal({ rule, onClose }) {
  const isNew = !rule
  const selfApprovalSupported = useCapability('allow_self_approval_supported')
  const { data: workflowConfig } = useWorkflowConfig()
  const maxApprovalRules = workflowConfig?.max_approval_rules ?? null
  const { data: allRules = [] } = useApprovalRules()
  const activeRules = allRules.filter(r => r.is_active && r.required).length
  const atLimit = maxApprovalRules !== null && activeRules >= maxApprovalRules

  const [form, setForm] = useState({
    action_type:        rule?.action_type        ?? 'playbook_run',
    action_target:      rule?.action_target      ?? '*',
    required:           rule?.required           ?? false,
    approver_groups:    (rule?.approver_groups    ?? []).join(', '),
    approver_users:     (rule?.approver_users     ?? []).join(', '),
    expiration_hours:   rule?.expiration_hours    ?? 48,
    allow_self_approval: rule?.allow_self_approval ?? false,
    is_active:          rule?.is_active           ?? true,
  })
  const [error, setError] = useState(null)

  const createMut = useCreateRule()
  const updateMut = useUpdateRule()
  const deleteMut = useDeleteRule()

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function parseIds(str) {
    return str.split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(n => !isNaN(n))
  }

  async function handleSave(e) {
    e.preventDefault()
    setError(null)
    const body = {
      ...form,
      approver_groups: parseIds(form.approver_groups),
      approver_users:  parseIds(form.approver_users),
      expiration_hours: Number(form.expiration_hours),
      allow_self_approval: selfApprovalSupported ? form.allow_self_approval : false,
    }
    try {
      if (isNew) {
        await createMut.mutateAsync(body)
      } else {
        // action_type + action_target sind immutabel (können nicht geändert werden)
        // eslint-disable-next-line no-unused-vars
        const { action_type: _at, action_target: _att, ...updates } = body
        await updateMut.mutateAsync({ id: rule.id, ...updates })
      }
      onClose(true)
    } catch (err) {
      setError(formatApiError(err, 'Speichern fehlgeschlagen.'))
    }
  }

  async function handleDelete() {
    if (rule?.source === 'meta_yaml') {
      setError('Regeln aus meta.yaml können nicht manuell gelöscht werden.')
      return
    }
    setError(null)
    try {
      await deleteMut.mutateAsync(rule.id)
      onClose(true)
    } catch (err) {
      setError(formatApiError(err, 'Löschen fehlgeschlagen.'))
    }
  }

  const busy = createMut.isPending || updateMut.isPending || deleteMut.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={e => e.target === e.currentTarget && onClose(false)}>
      <form onSubmit={handleSave} className="bg-portal-bg2 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] border border-portal-border">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-portal-border shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-portal-white">
              {isNew ? 'Neue Approval-Regel' : 'Regel bearbeiten'}
            </h2>
            {isNew && maxApprovalRules !== null && (
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                atLimit
                  ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
              }`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 shrink-0">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {activeRules} / {maxApprovalRules} Regeln
              </span>
            )}
          </div>
          <button type="button" onClick={() => onClose(false)} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Sektion: Aktion */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Aktionstyp <span className="text-portal-danger">*</span>
              </label>
              <select
                value={form.action_type}
                onChange={e => set('action_type', e.target.value)}
                disabled={!isNew}
                className={inputCls}
              >
                {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Ziel <span className="text-portal-danger">*</span>
                <span className="text-portal-text3 font-normal ml-1">(*  = alle)</span>
              </label>
              <input
                type="text"
                value={form.action_target}
                onChange={e => set('action_target', e.target.value)}
                disabled={!isNew}
                className={inputCls}
                placeholder="z.B. vm_deploy.yml oder *"
              />
            </div>
          </div>

          {/* Sektion: Pflicht & Ablauf */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <input
                id="required"
                type="checkbox"
                checked={form.required}
                onChange={e => set('required', e.target.checked)}
                className="w-4 h-4 accent-portal-accent"
              />
              <label htmlFor="required" className="text-sm font-medium text-portal-text">
                Genehmigung erforderlich
              </label>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="is_active"
                type="checkbox"
                checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 accent-portal-accent"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-portal-text">
                Aktiv
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Ablauf (Stunden) <span className="text-portal-danger">*</span>
              </label>
              <input
                type="number"
                value={form.expiration_hours}
                onChange={e => set('expiration_hours', e.target.value)}
                min={1} max={168}
                className={inputCls}
              />
              <p className="text-xs text-portal-text3 mt-0.5">1–168 Stunden</p>
            </div>
          </div>

          {/* Sektion: Approver */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-portal-text">Approver-Konfiguration</h3>
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Approver-Gruppen <span className="text-portal-text3 font-normal">(kommagetrennte IDs)</span>
              </label>
              <input
                type="text"
                value={form.approver_groups}
                onChange={e => set('approver_groups', e.target.value)}
                className={inputCls}
                placeholder="z.B. 1, 3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-portal-text mb-1">
                Approver-User <span className="text-portal-text3 font-normal">(kommagetrennte IDs)</span>
              </label>
              <input
                type="text"
                value={form.approver_users}
                onChange={e => set('approver_users', e.target.value)}
                className={inputCls}
                placeholder="z.B. 2, 5"
              />
            </div>
          </div>

          {/* Self-Approval (Plus-only) */}
          <div className="flex items-center gap-3">
            <input
              id="allow_self"
              type="checkbox"
              checked={form.allow_self_approval}
              onChange={e => set('allow_self_approval', e.target.checked)}
              disabled={!selfApprovalSupported}
              className="w-4 h-4 accent-portal-accent disabled:opacity-40"
            />
            <label htmlFor="allow_self" className={`text-sm font-medium flex items-center gap-2 ${!selfApprovalSupported ? 'opacity-60' : 'text-portal-text'}`}>
              Self-Approval erlauben
              {!selfApprovalSupported && <PlusBadge />}
            </label>
          </div>

          {error && <p className="text-sm text-portal-danger">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-portal-border shrink-0 flex items-center justify-between">
          <div>
            {!isNew && rule?.source !== 'meta_yaml' && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="px-3 py-2 text-sm text-portal-danger hover:underline disabled:opacity-50"
              >
                Regel löschen
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => onClose(false)} className="btn-secondary">
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={busy}
              className="btn-primary"
            >
              {busy ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
