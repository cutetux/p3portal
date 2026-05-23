// p3portal.org
const CONFIG = {
  online:  { dot: 'bg-green-400', text: 'text-green-400', label: 'online' },
  offline: { dot: 'bg-red-500',   text: 'text-red-400',   label: 'offline' },
  running: { dot: 'bg-green-400', text: 'text-green-400', label: 'running' },
  stopped: { dot: 'bg-zinc-500',  text: 'text-zinc-400',  label: 'stopped' },
  paused:  { dot: 'bg-yellow-400',text: 'text-yellow-400',label: 'paused' },
}

export default function StatusBadge({ status }) {
  const cfg = CONFIG[status] ?? CONFIG.offline
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 ${cfg.dot}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
    </span>
  )
}
