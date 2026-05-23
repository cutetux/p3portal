// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Admin-Tabelle aller Approval-Regeln.
import { useState } from 'react'
import ApprovalRuleSourceBadge from './ApprovalRuleSourceBadge'
import ApprovalRuleFormModal from './ApprovalRuleFormModal'

const ACTION_TYPE_LABELS = {
  playbook_run:         'Playbook-Ausführung',
  packer_build:         'Packer-Build',
  vm_delete:            'VM löschen',
  lxc_delete:           'LXC löschen',
  template_delete:      'Template löschen',
  owner_delete_request: 'Owner-Löschantrag',
  owner_adopt_request:  'VM adoptieren',
}

/** @param {{ rules: object[], isLoading: boolean, readOnly?: boolean }} */
export default function ApprovalRulesTable({ rules, isLoading, readOnly = false }) {
  const [editRule, setEditRule] = useState(null)
  const [showNew, setShowNew] = useState(false)

  const hasConflict = (rule) =>
    rule.meta_yaml_snapshot !== null && rule.source === 'ui_override'

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-portal-text">Regeln</h3>
        <button
          onClick={() => !readOnly && setShowNew(true)}
          disabled={readOnly}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-opacity ${
            readOnly
              ? 'bg-portal-bg3 text-portal-text3 cursor-not-allowed'
              : 'bg-portal-accent text-white hover:opacity-90'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Neue Regel
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-portal-text2 border-b border-portal-border">
              <th className="pb-2 pr-4 font-medium">Aktion</th>
              <th className="pb-2 pr-4 font-medium">Ziel</th>
              <th className="pb-2 pr-4 font-medium">Pflicht</th>
              <th className="pb-2 pr-4 font-medium">Ablauf (h)</th>
              <th className="pb-2 pr-4 font-medium">Quelle</th>
              <th className="pb-2 pr-4 font-medium">Aktiv</th>
              <th className="pb-2 pr-4 font-medium">Anträge</th>
              <th className="pb-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="py-8 text-center text-portal-text3">Lade …</td></tr>
            )}
            {!isLoading && rules.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-portal-text3 italic">Noch keine Regeln definiert</td></tr>
            )}
            {!isLoading && rules.map(rule => (
              <tr key={rule.id} className="border-b border-portal-border/50 hover:bg-portal-bg3/40">
                <td className="py-2.5 pr-4 font-medium text-portal-white">
                  {ACTION_TYPE_LABELS[rule.action_type] ?? rule.action_type}
                </td>
                <td className="py-2.5 pr-4 text-portal-text font-mono text-xs">
                  {rule.action_target}
                </td>
                <td className="py-2.5 pr-4">
                  {rule.required ? (
                    <span className="text-portal-success font-medium">✓ Ja</span>
                  ) : (
                    <span className="text-portal-text3">—</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-portal-text">{rule.expiration_hours}h</td>
                <td className="py-2.5 pr-4">
                  <ApprovalRuleSourceBadge source={rule.source} hasConflict={hasConflict(rule)} />
                </td>
                <td className="py-2.5 pr-4">
                  <span className={`inline-block w-2 h-2 rounded-full ${rule.is_active ? 'bg-portal-success' : 'bg-portal-text3'}`} />
                </td>
                <td className="py-2.5 pr-4 text-portal-text">
                  {rule.active_count > 0 ? (
                    <span className="font-medium text-portal-warn">{rule.active_count}</span>
                  ) : '0'}
                </td>
                <td className="py-2.5">
                  <button
                    onClick={() => !readOnly && setEditRule(rule)}
                    disabled={readOnly}
                    className={`text-xs ${readOnly ? 'text-portal-text3 cursor-not-allowed' : 'text-portal-accent hover:underline'}`}
                  >
                    Bearbeiten
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editRule && (
        <ApprovalRuleFormModal rule={editRule} onClose={() => setEditRule(null)} />
      )}
      {showNew && (
        <ApprovalRuleFormModal rule={null} onClose={() => setShowNew(false)} />
      )}
    </>
  )
}
