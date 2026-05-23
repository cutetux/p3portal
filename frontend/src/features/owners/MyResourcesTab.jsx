// p3portal.org
// PROJ-48: MyAccountPage-Tab „Meine Ressourcen" (AC-VIS-5).
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMyOwners } from './hooks/useOwners'

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function MyResourcesTab() {
  const { t } = useTranslation()
  const { data: owners, isLoading, error } = useMyOwners()

  if (isLoading) {
    return <p className="text-sm text-gray-400 dark:text-zinc-500 animate-pulse">{t('common.loading')}</p>
  }
  if (error) {
    return <p className="text-sm text-red-400">{t('owners.my_resources_load_error')}</p>
  }

  if (!owners || owners.length === 0) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-8 text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('owners.my_resources_empty')}</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              {t('owners.my_resources_col_name')}
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              {t('owners.my_resources_col_type')}
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              {t('owners.my_resources_col_node')}
            </th>
            <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">
              {t('owners.my_resources_col_since')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {owners.map(o => (
            <tr key={`${o.resource_type}-${o.node_id}-${o.vmid}`}
              className="hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
              <td className="py-2.5 px-3 font-medium text-gray-900 dark:text-zinc-100">
                <Link
                  to={`/vm/${o.node_name ?? o.node_id}/${o.resource_type === 'vm' ? 'qemu' : 'lxc'}/${o.vmid}`}
                  className="hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
                >
                  {o.vm_name ?? `${o.resource_type.toUpperCase()} ${o.vmid}`}
                </Link>
              </td>
              <td className="py-2.5 px-3 text-gray-600 dark:text-zinc-400">
                <span className={`text-xs px-1.5 py-0.5 rounded border ${
                  o.resource_type === 'lxc'
                    ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 border-teal-200 dark:border-teal-800'
                    : 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-600'
                }`}>
                  {o.resource_type === 'lxc' ? 'CT' : 'VM'}
                </span>
              </td>
              <td className="py-2.5 px-3 text-gray-600 dark:text-zinc-400">{o.node_name ?? o.node_id}</td>
              <td className="py-2.5 px-3 text-gray-500 dark:text-zinc-500 text-xs">{formatDate(o.assigned_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
