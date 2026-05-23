// p3portal.org
// PROJ-60: Hook für editions-spezifische Capabilities.
// Einziger erlaubter Ort (neben useLicenseLimits.jsx und frontend/src/plus/) für Editions-Checks in Community-Komponenten.
import { useQuery } from '@tanstack/react-query'
import { fetchCapabilities } from '../api/capabilities'

/** Liefert das vollständige Capabilities-Objekt { [key]: boolean }. */
export function useCapabilities() {
  const { data } = useQuery({
    queryKey: ['capabilities'],
    queryFn: fetchCapabilities,
    staleTime: Infinity,
  })
  return data ?? {}
}

/**
 * Prüft eine einzelne Capability.
 * @param {string} name - Capability-Key aus CAPABILITY_KEYS
 * @returns {boolean}
 */
export function useCapability(name) {
  const caps = useCapabilities()
  return caps[name] ?? false
}

/**
 * Liefert ein Listen-Capability-Feld (z.B. extra_portal_permissions).
 * @param {string} key - Capabilities-Key der eine Liste enthält
 * @returns {string[]}
 */
export function useCapabilityList(key) {
  const caps = useCapabilities()
  return Array.isArray(caps[key]) ? caps[key] : []
}
