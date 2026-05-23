// p3portal.org
/**
 * Normalisiert Fehler aus axios-Responses zu einem lesbaren String.
 *
 * FastAPI/Pydantic v2 liefert Validierungsfehler als Array:
 *   detail: [{ type, loc, msg, input, ctx }, ...]
 * Direktes Rendern eines solchen Arrays erzeugt React-Error #31
 * ("Objects are not valid as a React child").
 *
 * Diese Helfer-Funktion erkennt das Format und baut einen kompakten
 * "loc: msg"-String. Strings, fehlende Detail-Felder und unbekannte
 * Strukturen werden auf einen Fallback abgebildet.
 */
export function formatApiError(err, fallback = 'Aktion fehlgeschlagen.') {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map(d => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter(p => p !== 'body').join('.') : ''
        const msg = d?.msg ?? ''
        return loc ? `${loc}: ${msg}` : msg
      })
      .filter(Boolean)
      .join('; ') || fallback
  }
  if (detail && typeof detail === 'object') {
    return detail.msg ?? JSON.stringify(detail)
  }
  return err?.message ?? fallback
}
