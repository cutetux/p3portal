// p3portal.org
export default function RbacAssignmentsTable({ assignments }) {
  if (!assignments || assignments.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-zinc-400 py-4">
        Keine Ressourcen zugewiesen – bitte Admin kontaktieren.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left py-2 pr-6 font-medium text-gray-500 dark:text-zinc-400">Ressource</th>
            <th className="text-left py-2 font-medium text-gray-500 dark:text-zinc-400">Berechtigungen</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a, i) => (
            <tr key={i} className="border-b border-gray-100 dark:border-zinc-800">
              <td className="py-2 pr-6 font-mono text-gray-700 dark:text-zinc-300">
                {a.resource_type === 'vm' ? 'VM' : 'LXC'}&nbsp;{a.resource_id}
              </td>
              <td className="py-2 text-gray-600 dark:text-zinc-400">
                {a.permissions.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
