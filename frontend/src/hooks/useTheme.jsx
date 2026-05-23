// p3portal.org
import { createContext, useContext, useEffect, useState } from 'react'

export const BUILTIN_THEMES = [
  {
    id: 'dark',
    name: 'Dark',
    is_builtin: true,
    vars: {
      '--sidebar': '#18181b',
      '--bg': '#09090b',
      '--bg2': '#27272a',
      '--bg3': '#3f3f46',
      '--border': '#3f3f46',
      '--border2': '#52525b',
      '--text': '#d4d4d8',
      '--text2': '#a1a1aa',
      '--text3': '#71717a',
      '--white': '#f4f4f5',
      '--accent': '#f97316',
      '--green': '#22c55e',
      '--orange': '#f97316',
      '--blue': '#3b82f6',
      '--purple': '#7c5cbf',
      '--red': '#ef4444',
      '--yellow': '#eab308',
      '--font': "'Inter', sans-serif",
      '--radius-card': '4px',
      '--radius-btn': '3px',
    },
  },
  {
    id: 'p3orange',
    name: 'P3 Orange',
    is_builtin: true,
    vars: {
      '--sidebar': '#16181e',
      '--bg': '#1e2028',
      '--bg2': '#23262f',
      '--bg3': '#2a2d38',
      '--border': '#2e3140',
      '--border2': '#3a3d4d',
      '--text': '#c9cdd8',
      '--text2': '#8b909f',
      '--text3': '#5c6070',
      '--white': '#e8eaf0',
      '--accent': '#e07b39',
      '--green': '#4caf50',
      '--orange': '#e07b39',
      '--blue': '#3b82f6',
      '--purple': '#7c5cbf',
      '--red': '#c0392b',
      '--yellow': '#eab308',
      '--font': "'Inter', sans-serif",
      '--radius-card': '12px',
      '--radius-btn': '8px',
    },
  },
  {
    id: 'p3blue',
    name: 'P3 Blue',
    is_builtin: true,
    vars: {
      '--sidebar': '#0d1117',
      '--bg': '#161b22',
      '--bg2': '#1c2128',
      '--bg3': '#21262d',
      '--border': '#30363d',
      '--border2': '#3d444d',
      '--text': '#cdd9e5',
      '--text2': '#8b949e',
      '--text3': '#484f58',
      '--white': '#e6edf3',
      '--accent': '#2563eb',
      '--green': '#3fb950',
      '--orange': '#e07b39',
      '--blue': '#2563eb',
      '--purple': '#8b5cf6',
      '--red': '#f85149',
      '--yellow': '#eab308',
      '--font': "'Inter', sans-serif",
      '--radius-card': '10px',
      '--radius-btn': '7px',
    },
  },
  {
    id: 'light',
    name: 'Light',
    is_builtin: true,
    vars: {
      '--sidebar': '#f1f5f9',
      '--bg': '#f8fafc',
      '--bg2': '#ffffff',
      '--bg3': '#e2e8f0',
      '--border': '#e2e8f0',
      '--border2': '#cbd5e1',
      '--text': '#334155',
      '--text2': '#64748b',
      '--text3': '#94a3b8',
      '--white': '#0f172a',
      '--accent': '#f97316',
      '--green': '#16a34a',
      '--orange': '#f97316',
      '--blue': '#2563eb',
      '--purple': '#7c3aed',
      '--red': '#dc2626',
      '--yellow': '#ca8a04',
      '--font': "'Inter', sans-serif",
      '--radius-card': '8px',
      '--radius-btn': '6px',
    },
  },
  {
    id: 'hc',
    name: 'High Contrast',
    is_builtin: true,
    vars: {
      '--sidebar': '#000000',
      '--bg': '#000000',
      '--bg2': '#0d0d0d',
      '--bg3': '#1a1a1a',
      '--border': '#ffffff',
      '--border2': '#cccccc',
      '--text': '#ffffff',
      '--text2': '#eeeeee',
      '--text3': '#cccccc',
      '--white': '#ffffff',
      '--accent': '#ffff00',
      '--green': '#00ff7f',
      '--orange': '#ff8c00',
      '--blue': '#00bfff',
      '--purple': '#da70d6',
      '--red': '#ff4444',
      '--yellow': '#ffff00',
      '--font': "'Inter', sans-serif",
      '--radius-card': '0px',
      '--radius-btn': '0px',
    },
  },
]

const BUILTIN_MAP = Object.fromEntries(BUILTIN_THEMES.map(t => [t.id, t]))
const DARK_IDS = new Set(['dark', 'p3orange', 'p3blue', 'hc'])

// PROJ-58: Defaults für neu eingeführte Variablen – greifen wenn ein älteres
// hochgeladenes Theme die Variable nicht enthält (Forward-Compat).
const FORWARD_COMPAT_DEFAULTS = {
  '--yellow': '#eab308',
}

function applyVars(themeId, customVars) {
  const root = document.documentElement
  const vars = customVars ?? BUILTIN_MAP[themeId]?.vars
  if (!vars) return
  Object.entries(FORWARD_COMPAT_DEFAULTS).forEach(([k, v]) => {
    if (!vars[k]) root.style.setProperty(k, v)
  })
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  if (DARK_IDS.has(themeId)) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => localStorage.getItem('p3-theme') ?? 'p3orange')

  useEffect(() => {
    applyVars(themeId)
    localStorage.setItem('p3-theme', themeId)
  }, [themeId])

  const applyCustomTheme = (id, vars) => {
    localStorage.setItem('p3-theme', id)
    setThemeId(id)
    applyVars(id, vars)
  }

  return (
    <ThemeContext.Provider value={{ theme: themeId, setTheme: setThemeId, applyCustomTheme, BUILTIN_THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
