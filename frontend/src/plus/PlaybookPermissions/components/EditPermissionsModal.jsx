// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
// PROJ-49: Modal zum Bearbeiten der Whitelist eines Playbooks.
// Layout-Standard: form-Wrapper, max-w-3xl, Sticky-Footer (PROJ-Standard).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePlaybookPermissions } from '../hooks'
import { formatApiError } from '../../../api/errors'
import ConfirmModal from '../../../components/common/ConfirmModal'
import SubjectPicker from './SubjectPicker'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return iso
  }
}

export default function EditPermissionsModal({ playbook, onClose }) {
  const { t } = useTranslation()
  const { permissions, loading, addPermission, removePermission } = usePlaybookPermissions(playbook.name)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(null)

  const handleAdd = async ({ subjectType, subjectId }) => {
    setError('')
    try {
      await addPermission.mutateAsync({ subjectType, subjectId })
    } catch (err) {
      const msg = formatApiError(err, t('playbook_permissions.add_error'))
      if (err?.response?.status === 409) {
        setError(t('playbook_permissions.duplicate_entry'))
      } else {
        setError(msg)
      }
    }
  }

  const handleRemove = (entry) => {
    setConfirm({
      title: t('playbook_permissions.remove_confirm_title'),
      body: t('playbook_permissions.remove_confirm_body', { label: entry.subject_label }),
      variant: 'danger',
      onConfirm: async () => {
        setError('')
        try {
          await removePermission.mutateAsync(entry.id)
        } catch (err) {
          setError(formatApiError(err, t('playbook_permissions.remove_error')))
        }
      },
    })
  }

  const isBusy = addPermission.isPending || removePermission.isPending

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]"
        onSubmit={e => e.preventDefault()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('playbook_permissions.modal_title', { name: playbook.name })}
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            {t('playbook_permissions.modal_subtitle')}
          </p>
        </div>

        {/* Body (scrollbar) */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Fehleranzeige */}
          {error && (
            <div className="px-3 py-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400 rounded-md">
              {error}
            </div>
          )}

          {/* Sektion: Subjekt hinzufügen */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('playbook_permissions.section_add_subject')}
            </h3>
            <SubjectPicker onAdd={handleAdd} disabled={isBusy} />
          </section>

          {/* Sektion: Aktuelle Einträge */}
          <section>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('playbook_permissions.section_entries')}
              {permissions.length > 0 && (
                <span className="ml-2 text-gray-400 dark:text-zinc-500 normal-case font-normal">
                  ({permissions.length})
                </span>
              )}
            </h3>

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-12 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />)}
              </div>
            ) : permissions.length === 0 ? (
              <div className="flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-lg px-4 py-8 text-sm text-gray-400 dark:text-zinc-500">
                {t('playbook_permissions.no_entries')}
              </div>
            ) : (
              <ul className="space-y-2">
                {permissions.map((entry, idx) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-4 py-3 border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-950 rounded-lg"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5 rounded shrink-0">
                        #{idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-zinc-200 truncate">
                          {entry.subject_label}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-zinc-500">
                          <span className={`inline-block px-1.5 py-0.5 rounded mr-1 ${
                            entry.subject_type === 'user'
                              ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400'
                              : 'bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400'
                          }`}>
                            {entry.subject_type === 'user'
                              ? t('playbook_permissions.subject_user')
                              : t('playbook_permissions.subject_group')}
                          </span>
                          {entry.added_by_username && (
                            <>· {t('playbook_permissions.added_by', { who: entry.added_by_username })}</>
                          )}
                          {' · '}{formatDate(entry.added_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(entry)}
                      disabled={isBusy}
                      className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors disabled:opacity-40 shrink-0"
                    >
                      {t('playbook_permissions.remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Sticky Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400 dark:text-zinc-500">
            {t('playbook_permissions.footer_count', { count: permissions.length })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            {t('common.close')}
          </button>
        </div>
      </form>

      {confirm && (
        <ConfirmModal
          {...confirm}
          onClose={() => setConfirm(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
