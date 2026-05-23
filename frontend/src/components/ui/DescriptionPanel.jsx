// p3portal.org
import { useState, useEffect } from 'react'

// ── Inline Markdown renderer ──────────────────────────────────────────────────

export function renderInline(text) {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1] !== undefined) {
      parts.push(<strong key={match.index}>{match[1]}</strong>)
    } else if (match[2] !== undefined) {
      parts.push(<em key={match.index}>{match[2]}</em>)
    } else if (match[3] !== undefined) {
      parts.push(
        <code key={match.index} className="text-xs font-mono bg-gray-100 dark:bg-zinc-700 px-1 py-0.5">
          {match[3]}
        </code>
      )
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts.length === 0 ? text : parts
}

export function renderMarkdown(content) {
  const lines = content.split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={`code-${i}`} className="text-xs font-mono bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 p-3 overflow-x-auto my-2 whitespace-pre">
          {codeLines.join('\n')}
        </pre>
      )
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-xs font-bold text-gray-900 dark:text-zinc-100 uppercase tracking-wide mt-4 mb-1">
          {renderInline(line.slice(4))}
        </h3>
      )
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mt-4 mb-1.5">
          {renderInline(line.slice(3))}
        </h2>
      )
    } else if (line.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-sm font-bold text-gray-900 dark:text-zinc-100 mb-2">
          {renderInline(line.slice(2))}
        </h1>
      )
    } else if (/^-{3,}$/.test(line.trim())) {
      elements.push(<hr key={i} className="border-gray-200 dark:border-zinc-700 my-3" />)
    } else if (/^[*-] /.test(line)) {
      elements.push(
        <div key={i} className="flex gap-1.5 text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
          <span className="shrink-0 mt-1 w-1 h-1 rounded-full bg-gray-400 dark:bg-zinc-500" />
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    } else {
      elements.push(
        <p key={i} className="text-xs text-gray-700 dark:text-zinc-300 leading-relaxed">
          {renderInline(line)}
        </p>
      )
    }
    i++
  }
  return elements
}

// ── Panel widths (shared across all usages) ───────────────────────────────────

const PANEL_CLS = 'w-80 lg:w-96 xl:w-[28rem] 2xl:w-[36rem] shrink-0 border-l border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'

// ── Generic DescriptionPanel ──────────────────────────────────────────────────
// Props:
//   resourceId  – any string ID; panel hides when falsy
//   fetchFn     – async (id) => { content: string | null }

export default function DescriptionPanel({ resourceId, fetchFn }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!resourceId) {
      setContent(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setContent(null)
    fetchFn(resourceId)
      .then(data => setContent(data.content ?? null))
      .catch(() => setContent(null))
      .finally(() => setLoading(false))
  }, [resourceId, fetchFn])

  if (!resourceId) return null

  if (loading) {
    return (
      <div className={`${PANEL_CLS} flex items-center justify-center`}>
        <span className="text-xs text-gray-400 dark:text-zinc-500">Lädt…</span>
      </div>
    )
  }

  if (!content) {
    return (
      <div className={`${PANEL_CLS} flex flex-col items-center justify-center p-6 text-center`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 dark:text-zinc-600 mb-3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <p className="text-xs text-gray-400 dark:text-zinc-500 leading-relaxed">
          Keine Dokumentation vorhanden.
        </p>
        <p className="mt-1 text-xs text-gray-300 dark:text-zinc-600 font-mono">description.md</p>
      </div>
    )
  }

  return (
    <div className={`${PANEL_CLS} overflow-y-auto`}>
      <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700 px-4 py-2.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          Dokumentation
        </span>
      </div>
      <div className="p-4 space-y-1">
        {renderMarkdown(content)}
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
