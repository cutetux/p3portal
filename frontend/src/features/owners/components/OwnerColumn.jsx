// p3portal.org
// PROJ-48: Owner-Spalten-Inhalt für Dashboard VM-Tabelle (AC-VIS-1).
// Erhält die vorberechneten ownerMap[`${nodeId}:${vmid}`] = [ownerEntry, ...] aus dem Bulk-Lookup.

export default function OwnerColumn({ owners }) {
  if (!owners || owners.length === 0) {
    return <span className="text-gray-300 dark:text-zinc-700 text-xs">–</span>
  }
  const first = owners[0].username
  const extra = owners.length - 1
  return (
    <span className="text-xs text-gray-700 dark:text-zinc-300">
      {first}
      {extra > 0 && (
        <span className="ml-1 text-gray-400 dark:text-zinc-500">+{extra}</span>
      )}
    </span>
  )
}
