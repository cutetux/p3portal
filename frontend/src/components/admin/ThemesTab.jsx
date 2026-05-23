// p3portal.org
import { useState, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useThemes } from '../../hooks/useThemes'
import { useTheme } from '../../hooks/useTheme'
import { setGlobalDefaultTheme, deleteTheme } from '../../api/themes'
import { useCapability } from '../../hooks/useCapability'
import { PlusComponents } from '../../plus'

const ThemeEditorModal = PlusComponents.ThemeEditor
const ThemesAdminActions = PlusComponents.ThemesAdminActions
const ThemeRowEditButton = PlusComponents.ThemeRowEditButton

function LockClosed({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="9" width="12" height="10" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function ColorChips({ vars }) {
  const chips = ['--sidebar', '--bg2', '--accent', '--text', '--green', '--red']
  return (
    <div className="flex gap-1">
      {chips.map(key => (
        <span
          key={key}
          title={`${key}: ${vars?.[key] ?? '?'}`}
          className="w-3 h-3 rounded-full border border-black/10 inline-block shrink-0"
          style={{ backgroundColor: vars?.[key] ?? '#888' }}
        />
      ))}
    </div>
  )
}

export default function ThemesTab({ globalDefault, onDefaultChanged }) {
  const { t } = useTranslation()
  const { themes, loading, reload } = useThemes()
  const { theme: activeTheme, setTheme } = useTheme()
  const isPlus = useCapability('theme_editor')
  const [msg, setMsg] = useState(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null) // null = new, object = edit

  const flash = (text, ok = true) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 2500)
  }

  const handleMessage = (text, ok = true) => flash(text, ok)

  const handlePreview = (th) => {
    setTheme(th.id)
    if (th.vars) {
      Object.entries(th.vars).forEach(([k, v]) =>
        document.documentElement.style.setProperty(k, v)
      )
    }
  }

  const handleSetDefault = async (themeId) => {
    try {
      await setGlobalDefaultTheme(themeId)
      onDefaultChanged?.(themeId)
      flash(t('appearance.default_set'))
    } catch {
      flash(t('common.error'), false)
    }
  }

  const handleDelete = async (themeId) => {
    if (!confirm(t('common.confirm') + '?')) return
    try {
      await deleteTheme(themeId)
      await reload()
      flash(t('appearance.deleted'))
      if (activeTheme === themeId) setTheme('dark')
    } catch {
      flash(t('common.error'), false)
    }
  }

  const openCreate = () => {
    setEditTarget(null)
    setEditorOpen(true)
  }

  const openEdit = (th, e) => {
    e.stopPropagation()
    setEditTarget(th)
    setEditorOpen(true)
  }

  const handleEditorSaved = async () => {
    await reload()
    flash(t('appearance.theme_saved'))
  }

  return (
    <div>
      {editorOpen && isPlus && ThemeEditorModal && (
        <Suspense fallback={null}>
          <ThemeEditorModal
            editTheme={editTarget}
            onClose={() => setEditorOpen(false)}
            onSaved={handleEditorSaved}
          />
        </Suspense>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
          {t('appearance.theme_tab')}
        </span>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`text-xs ${msg.ok ? 'text-green-500' : 'text-red-500'}`}>{msg.text}</span>
          )}
          {isPlus && ThemesAdminActions ? (
            <Suspense fallback={null}>
              <ThemesAdminActions
                onCreateClick={openCreate}
                onReload={reload}
                onMessage={handleMessage}
              />
            </Suspense>
          ) : (
            <div className="flex items-center gap-2">
              <span title={t('appearance.no_plus')} className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 cursor-default">
                <LockClosed className="w-3.5 h-3.5" />
                {t('appearance.editor_create_btn')}
              </span>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('common.loading')}</p>
      ) : (
        <div className="space-y-2">
          {themes.map(th => (
            <div
              key={th.id}
              onClick={() => handlePreview(th)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded border cursor-pointer transition-colors ${
                activeTheme === th.id
                  ? 'border-portal-accent bg-portal-bg3'
                  : 'border-portal-border bg-portal-bg2 hover:border-portal-border2'
              }`}
            >
              <ColorChips vars={th.vars} />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-900 dark:text-zinc-100 font-medium">{th.name}</span>
                {th.is_builtin && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-zinc-600">{t('appearance.builtin')}</span>
                )}
                {globalDefault === th.id && (
                  <span className="ml-2 text-xs text-orange-500">{t('appearance.current_default')}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); handleSetDefault(th.id) }}
                  className="btn-table"
                >
                  {t('appearance.set_as_default')}
                </button>
                {!th.is_builtin && isPlus && ThemeRowEditButton && (
                  <Suspense fallback={null}>
                    <ThemeRowEditButton theme={th} onEdit={openEdit} />
                  </Suspense>
                )}
                {!th.is_builtin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(th.id) }}
                    className="btn-table-danger"
                  >
                    {t('appearance.delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400 dark:text-zinc-600">{t('appearance.upload_theme_hint')}</p>
    </div>
  )
}
