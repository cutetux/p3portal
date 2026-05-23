// p3portal.org
function barColor(pct, warnAt, critAt) {
  if (pct >= critAt) return 'bg-red-500'
  if (pct >= warnAt) return 'bg-yellow-500'
  return 'bg-orange-500'
}

export default function ResourceBar({ label, pct, detail, warnAt = 65, critAt = 85 }) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0))
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-400 mb-1">
        <span>{label}</span>
        <span className="tabular-nums">{detail ?? `${clamped.toFixed(0)}%`}</span>
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-zinc-700 overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${barColor(clamped, warnAt, critAt)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}
