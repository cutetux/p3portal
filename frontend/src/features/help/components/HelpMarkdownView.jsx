// p3portal.org
// PROJ-57: Markdown-Renderer für Help-Inhalte.
// react-markdown ohne rehype-raw → HTML im MD wird als Text ausgegeben (XSS-sicher).
// Custom-Renderer für Links (help:-Schema = Soft-Navigation) und Code-Blöcke.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useCallback } from 'react'

// Build-Zeit-Bundle aller Repo-MDs via Vite import.meta.glob
// Vite 5: query:'?raw' + import:'default' statt deprecated as:'raw'
const repoMdBundle = import.meta.glob('../../help/**/*.md', { query: '?raw', import: 'default', eager: true })

// Build-Zeit-Bundle aller Repo-Bilder
const repoimgBundle = import.meta.glob('../../help/img/*.{png,jpg,jpeg}', { eager: true })

/**
 * Gibt das rohe Repo-MD-Bundle zurück (für helpResolver.js).
 * Keys: "de/dashboard", "en/system_settings/tabs/nodes", ...
 */
export function getRepoBundleMap() {
  const result = {}
  for (const [path, content] of Object.entries(repoMdBundle)) {
    // Vite 5 normalisiert ../../help/de/dashboard.md → ../de/dashboard.md
    // Daher matchen wir auf das tatsächliche Format: ../de/... oder ../../help/de/...
    const match = path.match(/(?:\/help\/|\.\.\/)((?:de|en)\/.+)\.md$/)
    if (match) {
      const key = match[1] // z.B. "de/dashboard"
      result[key] = content
    }
  }
  return result
}

/**
 * Löst eine relative Bild-URL aus dem MD gegen das Vite-Bundle auf.
 * "./img/screenshot.png" → "/assets/screenshot-abc123.png"
 */
function resolveImageSrc(src) {
  if (!src) return src
  // Nur relative Bilder auflösen
  if (src.startsWith('./img/')) {
    const filename = src.replace('./img/', '')
    const bundleKey = Object.keys(repoimgBundle).find(k => k.endsWith(`/img/${filename}`))
    if (bundleKey) return repoimgBundle[bundleKey].default || repoimgBundle[bundleKey]
  }
  // Externe URLs blockieren (kein Tracking-Pixel-Risiko)
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return null // → Broken-Image statt Tracking-Request
  }
  return src
}

export default function HelpMarkdownView({ content, onCrossLink }) {
  const handleCrossLink = useCallback((e, targetKey) => {
    e.preventDefault()
    e.stopPropagation()
    onCrossLink?.(targetKey)
  }, [onCrossLink])

  const components = {
    // Custom Link-Renderer: help:-Schema → Soft-Navigation
    a: ({ href, children, ...props }) => {
      if (href?.startsWith('help:')) {
        const targetKey = href.slice(5)
        return (
          <a
            href="#"
            onClick={(e) => handleCrossLink(e, targetKey)}
            className="text-[var(--accent)] hover:underline cursor-pointer"
            {...props}
          >
            {children}
          </a>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline break-all"
          {...props}
        >
          {children}
        </a>
      )
    },

    // Custom Code-Renderer: Syntax-Highlighting für Code-Blöcke
    code: ({ inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '')
      if (!inline && match) {
        return (
          <SyntaxHighlighter
            style={oneDark}
            language={match[1]}
            PreTag="div"
            className="rounded-md text-xs my-2 !bg-zinc-900"
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        )
      }
      return (
        <code
          className="bg-gray-100 dark:bg-zinc-800 text-gray-800 dark:text-zinc-200 rounded px-1 py-0.5 text-xs font-mono"
          {...props}
        >
          {children}
        </code>
      )
    },

    // Custom Image-Renderer: nur Repo-Bilder erlaubt; externe URLs blockiert
    img: ({ src, alt, ...props }) => {
      const resolved = resolveImageSrc(src)
      if (!resolved) {
        return (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400 italic">
            [Bild nicht verfügbar: {alt || src}]
          </span>
        )
      }
      return <img src={resolved} alt={alt || ''} className="max-w-full rounded-md my-2" {...props} />
    },

    // Tabellen-Styling
    table: ({ children }) => (
      <div className="overflow-x-auto my-3">
        <table className="text-sm border-collapse w-full">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 px-3 py-1.5 text-left font-semibold text-xs">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-gray-200 dark:border-zinc-700 px-3 py-1.5 text-xs">
        {children}
      </td>
    ),

    // Headings
    h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-gray-900 dark:text-zinc-100">{children}</h1>,
    h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-1.5 text-gray-800 dark:text-zinc-200 border-b border-gray-100 dark:border-zinc-800 pb-0.5">{children}</h2>,
    h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1 text-gray-700 dark:text-zinc-300">{children}</h3>,

    // Listen
    ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-2 text-sm text-gray-700 dark:text-zinc-300">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-2 text-sm text-gray-700 dark:text-zinc-300">{children}</ol>,
    li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,

    // Paragraphen
    p: ({ children }) => <p className="text-sm leading-relaxed text-gray-700 dark:text-zinc-300 my-1.5">{children}</p>,

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-[var(--accent)] pl-3 my-2 text-gray-600 dark:text-zinc-400 italic">
        {children}
      </blockquote>
    ),

    // Horizontale Linie
    hr: () => <hr className="my-4 border-gray-200 dark:border-zinc-700" />,
  }

  return (
    <div className="help-markdown-view prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
