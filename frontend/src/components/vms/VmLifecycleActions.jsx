// p3portal.org
// PROJ-102: „Lebenszyklus"-Aktionskarte auf der VM/LXC-Detailseite.
// Clonen / Migrieren / Zu Template konvertieren — zustands- und RBAC-gated.
// Jede Aktion öffnet ihr Modal; das Modal navigiert nach dem Job in den Live-Log.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import CloneModal from './CloneModal'
import MigrateModal from './MigrateModal'
import ConvertTemplateModal from './ConvertTemplateModal'

export default function VmLifecycleActions({ detail, isOperator }) {
  const { t } = useTranslation()
  const [modal, setModal] = useState(null)   // 'clone' | 'migrate' | 'template'

  if (!isOperator) return null

  const vm = {
    vmid: detail.vmid,
    node: detail.node,
    type: detail.type,
    name: detail.name,
    is_template: detail.is_template,
  }
  const running = detail.status === 'running'
  const stackManaged = !!detail.managed_by_stack
  const isTemplate = !!detail.is_template

  // Migrate: nur gestoppt + nicht stack-verwaltet (Single-Node prüft das Modal).
  const migrateDisabled = running || stackManaged
  const migrateReason = running
    ? t('vm_lifecycle.disabled_running')
    : stackManaged ? t('vm_lifecycle.disabled_stack') : ''
  // Convert: gestoppt + nicht stack + noch kein Template.
  const convertDisabled = running || stackManaged || isTemplate
  const convertReason = running
    ? t('vm_lifecycle.disabled_running')
    : stackManaged ? t('vm_lifecycle.disabled_stack')
    : isTemplate ? t('vm_lifecycle.disabled_is_template') : ''

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
        {t('vm_lifecycle.section_title')}
      </h2>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setModal('clone')} className="btn-table">
          {t('vm_lifecycle.clone_action')}
        </button>
        <button
          onClick={() => setModal('migrate')}
          disabled={migrateDisabled}
          title={migrateReason || undefined}
          className="btn-table"
        >
          {t('vm_lifecycle.migrate_action')}
        </button>
        <button
          onClick={() => setModal('template')}
          disabled={convertDisabled}
          title={convertReason || undefined}
          className="btn-table"
        >
          {t('vm_lifecycle.template_action')}
        </button>
      </div>

      {(migrateDisabled && migrateReason) && (
        <p className="mt-2 text-xs text-gray-400 dark:text-zinc-600">
          {t('vm_lifecycle.migrate_action')}: {migrateReason}
        </p>
      )}

      {modal === 'clone' && <CloneModal vm={vm} onClose={() => setModal(null)} />}
      {modal === 'migrate' && <MigrateModal vm={vm} onClose={() => setModal(null)} />}
      {modal === 'template' && <ConvertTemplateModal vm={vm} onClose={() => setModal(null)} />}
    </div>
  )
}
