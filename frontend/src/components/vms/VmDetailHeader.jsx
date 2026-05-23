// p3portal.org
import StatusBadge from '../ui/StatusBadge'
import VmActionButtons from './VmActionButtons'

function uptimeLabel(seconds) {
  if (!seconds) return '–'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function TypeBadge({ type, isTemplate }) {
  if (isTemplate) {
    return (
      <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 border border-purple-200 dark:border-purple-800">
        tmpl
      </span>
    )
  }
  if (type === 'lxc') {
    return (
      <span className="text-xs bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 border border-teal-200 dark:border-teal-800">
        CT
      </span>
    )
  }
  return (
    <span className="text-xs bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5">
      VM
    </span>
  )
}

export default function VmDetailHeader({ detail, isOperator, onActionSuccess }) {
  const showPowerButtons = isOperator && !detail.is_template

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Left: name + badges */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {detail.name}
            </h1>
            <TypeBadge type={detail.type} isTemplate={detail.is_template} />
            <StatusBadge status={detail.status} />
          </div>

          {/* Meta row: node / IP / uptime */}
          <div className="flex items-center gap-4 flex-wrap text-xs text-gray-500 dark:text-zinc-400">
            <span>
              <span className="text-gray-400 dark:text-zinc-600 mr-1">Node</span>
              <span className="text-gray-700 dark:text-zinc-300 font-medium">{detail.node}</span>
            </span>
            <span>
              <span className="text-gray-400 dark:text-zinc-600 mr-1">ID</span>
              <span className="text-gray-700 dark:text-zinc-300 font-mono">{detail.vmid}</span>
            </span>
            {detail.ip && (
              <span>
                <span className="text-gray-400 dark:text-zinc-600 mr-1">IP</span>
                <span className="text-gray-700 dark:text-zinc-300 font-mono">{detail.ip}</span>
              </span>
            )}
            {detail.status === 'running' && (
              <span>
                <span className="text-gray-400 dark:text-zinc-600 mr-1">Uptime</span>
                <span className="text-gray-700 dark:text-zinc-300">{uptimeLabel(detail.uptime)}</span>
              </span>
            )}
          </div>

          {/* Tags */}
          {detail.tags?.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {detail.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-1.5 py-0.5"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: power buttons */}
        {showPowerButtons && (
          <div className="shrink-0">
            <VmActionButtons
              vm={{ vmid: detail.vmid, node: detail.node, status: detail.status, permissions: null }}
              onSuccess={() => onActionSuccess?.()}
              onError={() => {}}
            />
          </div>
        )}
      </div>
    </div>
  )
}
