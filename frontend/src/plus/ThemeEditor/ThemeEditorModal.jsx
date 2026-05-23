// SPDX-License-Identifier: LicenseRef-P3-Plus
// SPDX-FileCopyrightText: Copyright (C) 2026 rootq <contact@rootq.de>
// === P3 PLUS – PROPRIETARY ===
// Licensed under LICENSE-PLUS (see repo root)
// Modification/Redistribution prohibited (see LICENSE-PLUS for security-patch exception)
// Contact: license@p3portal.org

// p3portal.org
import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { createTheme, updateTheme } from '../../api/themes'

// All color CSS variables managed by the editor
const COLOR_VARS = [
  '--sidebar', '--bg', '--bg2', '--bg3',
  '--text', '--text2', '--text3', '--white', '--border', '--border2',
  '--accent', '--green', '--orange', '--blue', '--purple', '--red', '--yellow',
]

const RADIUS_VARS = [
  { key: '--radius-card', min: 0, max: 24 },
  { key: '--radius-btn',  min: 0, max: 16 },
]

// Grouped layout for the color picker
const COLOR_GROUPS = [
  {
    labelKey: 'appearance.editor_group_backgrounds',
    vars: [
      { key: '--sidebar', labelKey: 'appearance.editor_var_sidebar' },
      { key: '--bg',      labelKey: 'appearance.editor_var_bg' },
      { key: '--bg2',     labelKey: 'appearance.editor_var_bg2' },
      { key: '--bg3',     labelKey: 'appearance.editor_var_bg3' },
    ],
  },
  {
    labelKey: 'appearance.editor_group_texts',
    vars: [
      { key: '--text',    labelKey: 'appearance.editor_var_text' },
      { key: '--text2',   labelKey: 'appearance.editor_var_text2' },
      { key: '--text3',   labelKey: 'appearance.editor_var_text3' },
      { key: '--white',   labelKey: 'appearance.editor_var_white' },
      { key: '--border',  labelKey: 'appearance.editor_var_border' },
      { key: '--border2', labelKey: 'appearance.editor_var_border2' },
    ],
  },
  {
    labelKey: 'appearance.editor_group_accent',
    vars: [
      { key: '--accent',  labelKey: 'appearance.editor_var_accent' },
      { key: '--green',   labelKey: 'appearance.editor_var_green' },
      { key: '--orange',  labelKey: 'appearance.editor_var_orange' },
      { key: '--blue',    labelKey: 'appearance.editor_var_blue' },
      { key: '--purple',  labelKey: 'appearance.editor_var_purple' },
      { key: '--red',     labelKey: 'appearance.editor_var_red' },
      { key: '--yellow',  labelKey: 'appearance.editor_var_yellow' },
    ],
  },
]

// Defaults derived from P3 Orange theme (used when creating a new theme)
const DEFAULT_COLORS = {
  '--sidebar': '#16181e',
  '--bg':      '#1e2028',
  '--bg2':     '#23262f',
  '--bg3':     '#2a2d38',
  '--border':  '#2e3140',
  '--border2': '#3a3d4d',
  '--text':    '#c9cdd8',
  '--text2':   '#8b909f',
  '--text3':   '#5c6070',
  '--white':   '#e8eaf0',
  '--accent':  '#e07b39',
  '--green':   '#4caf50',
  '--orange':  '#e07b39',
  '--blue':    '#3b82f6',
  '--purple':  '#7c5cbf',
  '--red':     '#c0392b',
  '--yellow':  '#eab308',
}
const DEFAULT_RADII = { '--radius-card': 12, '--radius-btn': 8 }

function parsePx(val) {
  return parseInt(val, 10) || 0
}

function toHex(val) {
  if (!val) return '#888888'
  // Already a hex string
  if (/^#[0-9a-fA-F]{6}$/.test(val.trim())) return val.trim()
  return '#888888'
}

function buildVarsObject(colors, radii) {
  return {
    ...colors,
    '--radius-card': `${radii['--radius-card']}px`,
    '--radius-btn':  `${radii['--radius-btn']}px`,
    '--font':        "'Inter', sans-serif",
  }
}

function applyVarsToDOM(colors, radii) {
  const root = document.documentElement
  Object.entries(colors).forEach(([k, v]) => root.style.setProperty(k, v))
  root.style.setProperty('--radius-card', `${radii['--radius-card']}px`)
  root.style.setProperty('--radius-btn',  `${radii['--radius-btn']}px`)
}

function initFromTheme(editTheme) {
  if (!editTheme?.vars) {
    return { colors: { ...DEFAULT_COLORS }, radii: { ...DEFAULT_RADII } }
  }
  const colors = {}
  for (const k of COLOR_VARS) {
    colors[k] = toHex(editTheme.vars[k] ?? DEFAULT_COLORS[k])
  }
  const radii = {
    '--radius-card': parsePx(editTheme.vars['--radius-card'] ?? '12px'),
    '--radius-btn':  parsePx(editTheme.vars['--radius-btn']  ?? '8px'),
  }
  return { colors, radii }
}

export default function ThemeEditorModal({ onClose, editTheme, onSaved }) {
  const { t } = useTranslation()
  const { theme: activeThemeId } = useTheme()

  const isEdit = !!editTheme

  const [name, setName]       = useState(editTheme?.name ?? '')
  const [mode, setMode]       = useState('picker') // 'picker' | 'json'
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Separate color and radius state for picker mode
  const { colors: initColors, radii: initRadii } = initFromTheme(editTheme)
  const [colors, setColors] = useState(initColors)
  const [radii,  setRadii]  = useState(initRadii)

  // Snapshot: store the theme ID + all current CSS var values to restore on cancel
  const snapshotRef = useRef(null)
  useEffect(() => {
    const root = document.documentElement
    const snap = { _themeId: activeThemeId }
    for (const k of COLOR_VARS) {
      snap[k] = root.style.getPropertyValue(k)
    }
    for (const r of RADIUS_VARS) {
      snap[r.key] = root.style.getPropertyValue(r.key)
    }
    snapshotRef.current = snap
    // Apply initial state as live preview
    applyVarsToDOM(initColors, initRadii)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC key: cancel
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }) // re-bind each render so handleCancel closure is fresh

  const handleCancel = useCallback(() => {
    const snap = snapshotRef.current
    if (snap) {
      const root = document.documentElement
      for (const [k, v] of Object.entries(snap)) {
        if (k.startsWith('--')) root.style.setProperty(k, v)
      }
    }
    onClose()
  }, [onClose])

  // Live preview whenever colors or radii change (picker mode only)
  const applyPreview = useCallback((c, r) => {
    applyVarsToDOM(c, r)
  }, [])

  const handleColorChange = (key, value) => {
    const next = { ...colors, [key]: value }
    setColors(next)
    applyPreview(next, radii)
    // Keep JSON text in sync if visible
    if (mode === 'json') {
      setJsonText(JSON.stringify(buildVarsObject(next, radii), null, 2))
    }
  }

  const handleRadiusChange = (key, value) => {
    const next = { ...radii, [key]: Number(value) }
    setRadii(next)
    applyPreview(colors, next)
    if (mode === 'json') {
      setJsonText(JSON.stringify(buildVarsObject(colors, next), null, 2))
    }
  }

  // Mode toggle: Picker → JSON
  const switchToJson = () => {
    setJsonText(JSON.stringify(buildVarsObject(colors, radii), null, 2))
    setJsonError(null)
    setMode('json')
  }

  // Mode toggle: JSON → Picker
  const switchToPicker = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const next = {}
      for (const k of COLOR_VARS) {
        next[k] = toHex(parsed[k] ?? colors[k])
      }
      const nextRadii = {
        '--radius-card': parsePx(parsed['--radius-card'] ?? `${radii['--radius-card']}px`),
        '--radius-btn':  parsePx(parsed['--radius-btn']  ?? `${radii['--radius-btn']}px`),
      }
      setColors(next)
      setRadii(nextRadii)
      applyPreview(next, nextRadii)
      setJsonError(null)
      setMode('picker')
    } catch {
      setJsonError(t('appearance.editor_invalid_json'))
    }
  }

  const handleJsonChange = (val) => {
    setJsonText(val)
    setJsonError(null)
    // Validate on-the-fly but don't block typing
    try { JSON.parse(val) } catch { /* show error only on save/preview */ }
  }

  const applyJsonPreview = () => {
    try {
      const parsed = JSON.parse(jsonText)
      const nextColors = {}
      for (const k of COLOR_VARS) {
        nextColors[k] = toHex(parsed[k] ?? colors[k])
      }
      const nextRadii = {
        '--radius-card': parsePx(parsed['--radius-card'] ?? `${radii['--radius-card']}px`),
        '--radius-btn':  parsePx(parsed['--radius-btn']  ?? `${radii['--radius-btn']}px`),
      }
      applyPreview(nextColors, nextRadii)
      setJsonError(null)
    } catch {
      setJsonError(t('appearance.editor_invalid_json'))
    }
  }

  const getVarsForSave = () => {
    if (mode === 'json') {
      try {
        return JSON.parse(jsonText)
      } catch {
        return null
      }
    }
    return buildVarsObject(colors, radii)
  }

  const canSave = name.trim().length > 0 && name.trim().length <= 64 && !saving &&
    (mode !== 'json' || (() => { try { JSON.parse(jsonText); return true } catch { return false } })())

  const handleSave = async () => {
    const vars = getVarsForSave()
    if (!vars) {
      setJsonError(t('appearance.editor_invalid_json'))
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      if (isEdit) {
        await updateTheme(editTheme.id, name.trim(), vars)
      } else {
        await createTheme(name.trim(), vars)
      }
      onSaved()
      onClose()
    } catch (err) {
      const status = err.response?.status
      if (status === 409) setSaveError(t('appearance.editor_name_taken'))
      else if (status === 401) setSaveError(t('appearance.editor_session_expired'))
      else setSaveError(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg w-full max-w-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 uppercase tracking-wider">
            {isEdit ? t('appearance.editor_title_edit') : t('appearance.editor_title_new')}
          </h2>
          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded p-0.5">
            <button
              onClick={() => mode === 'json' ? switchToPicker() : null}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                mode === 'picker'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              {t('appearance.editor_mode_picker')}
            </button>
            <button
              onClick={() => mode === 'picker' ? switchToJson() : null}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                mode === 'json'
                  ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
              }`}
            >
              {t('appearance.editor_mode_json')}
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Name field */}
          <div>
            <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
              {t('appearance.editor_name_label')}
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={64}
              placeholder={t('appearance.editor_name_placeholder')}
              className={inputCls}
              autoFocus
            />
            {name.trim().length === 0 && name.length > 0 && (
              <p className="mt-1 text-xs text-red-500">{t('appearance.editor_name_required')}</p>
            )}
            {name.trim().length > 64 && (
              <p className="mt-1 text-xs text-red-500">{t('appearance.editor_name_too_long')}</p>
            )}
          </div>

          {/* Color Picker mode */}
          {mode === 'picker' && (
            <div className="space-y-4">
              {COLOR_GROUPS.map(group => (
                <div key={group.labelKey}>
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                    {t(group.labelKey)}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.vars.map(({ key, labelKey }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="color"
                          value={colors[key] ?? '#888888'}
                          onChange={e => handleColorChange(key, e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border border-zinc-300 dark:border-zinc-600 p-0 bg-transparent"
                        />
                        <span className="text-xs text-zinc-700 dark:text-zinc-300 flex-1 truncate">
                          {t(labelKey)}
                        </span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-600 font-mono tabular-nums">
                          {colors[key]}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              {/* Radius sliders */}
              <div>
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  {t('appearance.editor_group_radius')}
                </p>
                <div className="space-y-3">
                  {RADIUS_VARS.map(({ key, min, max }) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="text-xs text-zinc-700 dark:text-zinc-300 w-28 shrink-0">
                        {key === '--radius-card'
                          ? t('appearance.editor_radius_card')
                          : t('appearance.editor_radius_btn')}
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        value={radii[key]}
                        onChange={e => handleRadiusChange(key, e.target.value)}
                        className="flex-1 accent-orange-500"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 w-10 text-right tabular-nums">
                        {radii[key]}px
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Raw JSON mode */}
          {mode === 'json' && (
            <div>
              <textarea
                value={jsonText}
                onChange={e => handleJsonChange(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full px-3 py-2 text-xs font-mono rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
              />
              {jsonError && (
                <p className="mt-1 text-xs text-red-500">{jsonError}</p>
              )}
              <button
                onClick={applyJsonPreview}
                className="btn-secondary mt-2 text-xs px-3 py-1.5"
              >
                {t('appearance.editor_apply_preview')}
              </button>
            </div>
          )}

          {saveError && (
            <p className="text-xs text-red-500">{saveError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
          <button
            onClick={handleCancel}
            className="btn-secondary"
          >
            {t('appearance.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="text-sm px-4 py-2 rounded bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? '…' : t('appearance.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
