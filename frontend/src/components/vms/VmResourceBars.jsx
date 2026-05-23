// p3portal.org
import ResourceBar from '../ui/ResourceBar'

function fmtBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 ** 2)
  return `${mb.toFixed(0)} MB`
}

export default function VmResourceBars({ detail }) {
  const isStopped = detail.status !== 'running'

  const cpuPct  = detail.cpu_usage != null ? detail.cpu_usage * 100 : null
  const memUsed = detail.mem_used
  const memTotal = detail.mem_total || 0
  const memPct  = memTotal > 0 && memUsed != null ? (memUsed / memTotal) * 100 : null

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-4">
        Ressourcen
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* CPU */}
        {isStopped || cpuPct == null ? (
          <div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-400 mb-1">
              <span>CPU ({detail.cpu_cores} {detail.cpu_cores === 1 ? 'Kern' : 'Kerne'})</span>
              <span className="tabular-nums text-gray-400 dark:text-zinc-600">–</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-zinc-700" />
          </div>
        ) : (
          <ResourceBar
            label={`CPU (${detail.cpu_cores} ${detail.cpu_cores === 1 ? 'Kern' : 'Kerne'})`}
            pct={cpuPct}
            detail={`${cpuPct.toFixed(1)}%`}
          />
        )}

        {/* RAM */}
        {isStopped || memPct == null ? (
          <div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-400 mb-1">
              <span>RAM ({fmtBytes(memTotal)})</span>
              <span className="tabular-nums text-gray-400 dark:text-zinc-600">–</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-zinc-700" />
          </div>
        ) : (
          <ResourceBar
            label={`RAM (${fmtBytes(memTotal)})`}
            pct={memPct}
            detail={`${fmtBytes(memUsed)} / ${fmtBytes(memTotal)}`}
          />
        )}
      </div>
    </div>
  )
}
