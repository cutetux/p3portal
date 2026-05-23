// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-50: Tabelle der Approver-Sicht mit Filter, Spalten und Detail-Modal.
import { useState } from 'react'
import ApprovalStatusBadge from './ApprovalStatusBadge'
import ApprovalDetailModal from './ApprovalDetailModal'
import ExpiresAtDisplay from './ExpiresAtDisplay'

const ACTION_TYPE_LABELS = {
  playbook_run:         'Playbook-Ausführung',
  packer_build:         'Packer-Build',
  vm_delete:            'VM löschen',
  lxc_delete:           'LXC löschen',
  template_delete:      'Template löschen',
  owner_delete_request: 'Owner-Löschantrag',
  owner_adopt_request:  'VM adoptieren',
}

const ACTION_TYPES = [
  'playbook_run', 'packer_build', 'vm_delete', 'lxc_delete',
  'template_delete', 'owner_delete_request', 'owner_adopt_request',
]

const STATUS_OPTIONS = ['pending', 'suspended', 'approved', 'rejected', 'cancelled', 'expired', 'executed']

/**
 * @param {{
 *   items: object[],
 *   total: number,
 *   isLoading: boolean,
 *   filterStatus: string,
 *   filterActionType: string,
 *   onFilterChange: Function,
 * }} props
 */
export default function ApprovalsTable({
  items,
  total,
  isLoading,
  filterStatus,
  filterActionType,
  onFilterChange,
}) {
  const [selected, setSelected] = useState(null)

  return (
    <>
      {/* Filter-Zeile */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filterStatus}
          onChange={e => onFilterChange('status', e.target.value)}
          className="text-sm border border-portal-border rounded-lg px-3 py-1.5 bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent"
        >
          <option value="">Alle Status</option>
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>

        <select
          value={filterActionType}
          onChange={e => onFilterChange('action_type', e.target.value)}
          className="text-sm border border-portal-border rounded-lg px-3 py-1.5 bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent"
        >
          <option value="">Alle Aktionen</option>
          {ACTION_TYPES.map(t => (
            <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}</option>
          ))}
        </select>

        <span className="ml-auto self-center text-sm text-portal-text2">
          {total} Einträge
        </span>
      </div>

      {/* Tabelle */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-portal-text2 border-b border-portal-border">
              <th className="pb-2 pr-4 font-medium">Aktion</th>
              <th className="pb-2 pr-4 font-medium">Ziel</th>
              <th className="pb-2 pr-4 font-medium">Antragsteller</th>
              <th className="pb-2 pr-4 font-medium">Beantragt</th>
              <th className="pb-2 pr-4 font-medium">Läuft ab</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="py-8 text-center text-portal-text3">Lade …</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-portal-text3 italic">Keine Anträge vorhanden</td></tr>
            )}
            {!isLoading && items.map(item => (
              <tr
                key={item.id}
                onClick={() => setSelected(item)}
                className="border-b border-portal-border/50 hover:bg-portal-bg3/40 cursor-pointer transition-colors"
              >
                <td className="py-2.5 pr-4 text-portal-white font-medium">
                  {ACTION_TYPE_LABELS[item.action_type] ?? item.action_type}
                </td>
                <td className="py-2.5 pr-4 text-portal-text font-mono text-xs">
                  {item.action_target}
                </td>
                <td className="py-2.5 pr-4 text-portal-text">
                  {item.requester_username ?? '—'}
                  {item.is_own_request && (
                    <span className="ml-1 text-xs text-portal-info">(du)</span>
                  )}
                </td>
                <td className="py-2.5 pr-4 text-portal-text">
                  {new Date(item.requested_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="py-2.5 pr-4">
                  {item.status === 'pending' || item.status === 'suspended'
                    ? <ExpiresAtDisplay expiresAt={item.expires_at} />
                    : <span className="text-portal-text3 text-xs">—</span>
                  }
                </td>
                <td className="py-2.5 pr-4">
                  <ApprovalStatusBadge status={item.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <ApprovalDetailModal
          approval={selected}
          onClose={() => {
            setSelected(null)
          }}
        />
      )}
    </>
  )
}
