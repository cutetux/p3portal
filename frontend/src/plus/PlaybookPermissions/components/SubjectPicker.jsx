// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Toggle User|Gruppe + Dropdown für Subject-Auswahl.
// Proxmox-User werden gefiltert (auth_type='local' only, Edge-Case 4).
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchUsers } from '../../../api/admin'
import { groupsApi } from '../../../features/groups/api'

export default function SubjectPicker({ onAdd, disabled }) {
  const { t } = useTranslation()
  const [subjectType, setSubjectType] = useState('user')
  const [selectedId, setSelectedId] = useState('')
  const [users, setUsers] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchUsers(), groupsApi.list()])
      .then(([u, g]) => {
        // Nur lokale Nutzer (Proxmox-User haben kein local_users.id – Edge-Case 4)
        setUsers(u.filter(usr => usr.auth_type === 'local'))
        setGroups(g)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleAdd = () => {
    if (!selectedId) return
    onAdd?.({ subjectType, subjectId: Number(selectedId) })
    setSelectedId('')
  }

  const options = subjectType === 'user' ? users : groups
  const labelKey = subjectType === 'user' ? 'username' : 'name'

  return (
    <div className="space-y-3">
      {/* Toggle User | Gruppe */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-zinc-800 rounded-lg w-fit">
        {['user', 'group'].map(type => (
          <button
            key={type}
            type="button"
            onClick={() => { setSubjectType(type); setSelectedId('') }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              subjectType === type
                ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-zinc-100 shadow-sm'
                : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
            }`}
          >
            {subjectType === 'user' && type === 'user'
              ? t('playbook_permissions.subject_user')
              : type === 'user'
              ? t('playbook_permissions.subject_user')
              : t('playbook_permissions.subject_group')}
          </button>
        ))}
      </div>

      {/* Dropdown + Hinzufügen */}
      <div className="flex gap-2">
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          disabled={disabled || loading}
          className="flex-1 text-sm border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 rounded-md px-3 py-2 disabled:opacity-50"
        >
          <option value="">
            {loading
              ? t('common.loading')
              : options.length === 0
              ? t('playbook_permissions.no_subjects_available')
              : t('playbook_permissions.select_subject')}
          </option>
          {options.map(o => (
            <option key={o.id} value={o.id}>
              {o[labelKey]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || !selectedId || loading}
          className="px-4 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('playbook_permissions.add_subject')}
        </button>
      </div>
    </div>
  )
}
