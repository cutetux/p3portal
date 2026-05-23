// p3portal.org
const CAP_LABELS = {
  app_role: 'Portal-Rolle',
  vms: 'VMs',
  storage: 'Storage',
  sdn: 'SDN / Netzwerk',
  nodes: 'Nodes',
  access: 'Zugriffsverwaltung',
  dc: 'Datacenter',
}

export default function CapabilityCard({ type, permissions }) {
  const label = CAP_LABELS[type] ?? 'Sonstiges'
  return (
    <div className="border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 rounded-lg">
      <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
        {label}
      </p>
      <ul className="space-y-1">
        {permissions.map(perm => (
          <li key={perm} className="text-xs font-mono text-gray-700 dark:text-zinc-300">
            {perm}
          </li>
        ))}
      </ul>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
