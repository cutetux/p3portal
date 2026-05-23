// p3portal.org

function KvRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-zinc-500">{label}</span>
      <span className="text-xs text-gray-800 dark:text-zinc-200 font-mono">{value || '–'}</span>
    </div>
  )
}

const OS_LABELS = {
  l24: 'Linux 2.4', l26: 'Linux 2.6+', w2k: 'Windows 2000',
  wxp: 'Windows XP', w2k3: 'Windows 2003', w2k8: 'Windows 2008',
  wvista: 'Windows Vista', win7: 'Windows 7', win8: 'Windows 8/10',
  win10: 'Windows 10/11', win11: 'Windows 11', solaris: 'Solaris',
  other: 'Other',
}

function BoolBadge({ value }) {
  if (value === null || value === undefined) return <span className="text-xs font-mono text-gray-400 dark:text-zinc-600">–</span>
  return value
    ? <span className="text-xs font-mono text-green-600 dark:text-green-400">Ja</span>
    : <span className="text-xs font-mono text-gray-400 dark:text-zinc-500">Nein</span>
}

export default function VmConfigSection({ detail }) {
  const osLabel = OS_LABELS[detail.ostype] ?? detail.ostype ?? '–'

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-4">
        Konfiguration
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Base info */}
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">Allgemein</p>
          <KvRow label="CPU-Kerne" value={String(detail.cpu_cores)} />
          {detail.sockets != null && (
            <KvRow label="CPU-Sockets" value={String(detail.sockets)} />
          )}
          {detail.cpu_type && (
            <KvRow label="CPU-Typ" value={detail.cpu_type} />
          )}
          {detail.type === 'qemu' && <KvRow label="BIOS" value={detail.bios} />}
          <KvRow label="OS-Typ" value={osLabel} />
          <KvRow label="Typ" value={detail.type === 'qemu' ? 'QEMU/KVM' : 'LXC Container'} />
          {detail.onboot != null && (
            <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
              <span className="text-xs text-gray-500 dark:text-zinc-500">Start bei Boot</span>
              <BoolBadge value={detail.onboot} />
            </div>
          )}
          {detail.protection != null && (
            <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
              <span className="text-xs text-gray-500 dark:text-zinc-500">Lösch-Schutz</span>
              <BoolBadge value={detail.protection} />
            </div>
          )}
          {/* LXC-spezifisch */}
          {detail.lxc_hostname && (
            <KvRow label="Hostname (LXC)" value={detail.lxc_hostname} />
          )}
          {detail.lxc_ostemplate && (
            <KvRow label="OS-Template" value={detail.lxc_ostemplate} />
          )}
        </div>

        {/* Network interfaces */}
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">
            Netzwerk ({detail.networks.length})
          </p>
          {detail.networks.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-zinc-600">Keine Netzwerkadapter.</p>
          ) : (
            <div className="space-y-2">
              {detail.networks.map((nic) => (
                <div key={nic.id} className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-gray-700 dark:text-zinc-300">{nic.id}</span>
                    <span className="text-gray-400 dark:text-zinc-600">{nic.model}</span>
                  </div>
                  <div className="text-gray-500 dark:text-zinc-500">
                    {nic.bridge}{nic.mac ? ` · ${nic.mac}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Disks */}
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">
            Festplatten ({detail.disks.length})
          </p>
          {detail.disks.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-zinc-600">Keine Festplatten.</p>
          ) : (
            <div className="space-y-2">
              {detail.disks.map((disk) => (
                <div key={disk.id} className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-gray-700 dark:text-zinc-300">{disk.id}</span>
                    <span className="text-gray-400 dark:text-zinc-600 font-mono">{disk.size}</span>
                  </div>
                  <div className="text-gray-500 dark:text-zinc-500">{disk.storage}</div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Beschreibung / Notizen */}
      {detail.description && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-800">
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">Notizen</p>
          <pre className="text-xs text-gray-700 dark:text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 dark:bg-zinc-800 rounded px-3 py-2">
            {detail.description}
          </pre>
        </div>
      )}
    </div>
  )
}
