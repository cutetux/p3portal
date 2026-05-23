// p3portal.org
// PROJ-57: Clientseitiger Help-Content-Resolver.
// Priorität: persönlicher Override → globaler Override → Repo (lang) → Repo EN-Fallback → leer
import { isValidHelpKey } from './registry'

/**
 * Löst den anzuzeigenden Hilfetext auf.
 *
 * @param {object} params
 * @param {string} params.key          - Help-Key z.B. "dashboard"
 * @param {string} params.lang         - "de" | "en"
 * @param {Array}  params.overridesMe  - Array der eigenen HelpOverrideResponse
 * @param {Array}  params.overridesGlobal - Array der globalen HelpOverrideResponse
 * @param {object} params.repoBundle   - { "de/dashboard": "<md-content>", ... }
 * @returns {{ content: string|null, source: 'user'|'global'|'repo'|'none', languageFallback: boolean }}
 */
export function resolveHelpContent({ key, lang, overridesMe = [], overridesGlobal = [], repoBundle = {} }) {
  // 1. Persönlicher Override (lang)
  const myOverride = overridesMe.find(o => o.key === key && o.lang === lang)
  if (myOverride) {
    return { content: myOverride.content, source: 'user', languageFallback: false }
  }

  // 2. Globaler Override (lang)
  const globalOverride = overridesGlobal.find(o => o.key === key && o.lang === lang)
  if (globalOverride) {
    return { content: globalOverride.content, source: 'global', languageFallback: false }
  }

  // 3. Repo-Bundle (lang)
  const repoKey = keyToRepoBundleKey(key, lang)
  if (repoBundle[repoKey]) {
    return { content: repoBundle[repoKey], source: 'repo', languageFallback: false }
  }

  // 4. Fallback EN: Globaler Override EN (wenn lang != en)
  if (lang !== 'en') {
    const globalOverrideEn = overridesGlobal.find(o => o.key === key && o.lang === 'en')
    if (globalOverrideEn) {
      return { content: globalOverrideEn.content, source: 'global', languageFallback: true }
    }
  }

  // 5. Fallback EN: Repo-Bundle EN
  if (lang !== 'en') {
    const repoKeyEn = keyToRepoBundleKey(key, 'en')
    if (repoBundle[repoKeyEn]) {
      return { content: repoBundle[repoKeyEn], source: 'repo', languageFallback: true }
    }
  }

  // 6. Nichts gefunden
  return { content: null, source: 'none', languageFallback: false }
}

/**
 * Wandelt einen Help-Key + Sprache in einen Bundle-Map-Key um.
 * System: Punkte = Pfadtrenner
 * "system_settings.tabs.nodes" + "en" → "en/system_settings/tabs/nodes"
 */
export function keyToRepoBundleKey(key, lang) {
  return `${lang}/${key.replace(/\./g, '/')}`
}

/**
 * Gibt true zurück wenn der Key im Code referenziert wird, aber nicht in Registry steht.
 * Im DEV-Build wird zusätzlich eine Console-Warnung ausgegeben.
 */
export function checkKeyValid(key) {
  const valid = isValidHelpKey(key)
  if (!valid && import.meta.env.DEV) {
    console.warn(`[P3 Help] Unknown help key: "${key}" – kein Eintrag in registry.js`)
  }
  return valid
}
