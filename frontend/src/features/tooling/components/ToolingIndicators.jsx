// p3portal.org
// PROJ-66: Container – rendert alle Tool-Indikatoren dynamisch (AC-PLUS-3)
import { useToolingStatus } from '../hooks'
import ToolingIndicator from './ToolingIndicator'

// Reihenfolge: hardcoded Core-Tools zuerst (alphabetisch), Plus-Tools danach (AC-UI-8)
const CORE_ORDER = ['ansible', 'packer']

function sortedTools(statusObj) {
  if (!statusObj) return []
  const keys = Object.keys(statusObj)
  const core  = CORE_ORDER.filter(k => keys.includes(k))
  const extra = keys.filter(k => !CORE_ORDER.includes(k)).sort()
  return [...core, ...extra]
}

export default function ToolingIndicators() {
  const { data: status } = useToolingStatus()

  const tools = sortedTools(status)
  if (tools.length === 0) return null

  return (
    <div className="flex items-center gap-0.5">
      {tools.map(tool => (
        <ToolingIndicator
          key={tool}
          tool={tool}
          toolData={status[tool]}
        />
      ))}
    </div>
  )
}
