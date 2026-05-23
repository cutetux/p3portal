// p3portal.org
// PROJ-65: Severity-Konstanten und Farb-Helpers (portal-* Tokens, kein Roh-Tailwind)

export const SEVERITY_RANK = { critical: 3, warn: 2, info: 1, success: 0 }

/** Gibt die höchste Severity zurück, die ≥ info ist (success zählt nicht für Glocke) */
export function maxBellSeverity(severities) {
  let max = null
  for (const s of severities) {
    if (s === 'success') continue
    if (!max || SEVERITY_RANK[s] > SEVERITY_RANK[max]) max = s
  }
  return max
}

/** CSS-Klassen für den Severitätspunkt (●) */
export const SEVERITY_DOT = {
  critical: 'text-portal-danger',
  warn: 'text-portal-warn',
  info: 'text-portal-info',
  success: 'text-portal-success',
}

/** CSS-Klassen für Badge/Counter */
export const SEVERITY_BADGE_BG = {
  critical: 'bg-portal-danger text-portal-bg',
  warn: 'bg-portal-warn text-portal-bg',
  info: 'bg-portal-info text-portal-bg',
  success: 'bg-portal-success text-portal-bg',
}

/** CSS-Klassen für die Glocken-Farbe */
export const BELL_COLOR = {
  critical: 'text-portal-danger',
  warn: 'text-portal-warn',
  info: 'text-portal-info',
  null: 'text-portal-text3',
}

export function bellColor(maxSeverity) {
  return BELL_COLOR[maxSeverity] ?? BELL_COLOR.null
}
