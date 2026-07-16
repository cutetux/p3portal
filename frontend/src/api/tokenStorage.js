// p3portal.org
// PROJ-109: Zentrale Token-Persistenz ("Angemeldet bleiben").
//
// Default ist sessionStorage (wird beim Schließen geleert → XSS-Schutz, siehe
// .claude/rules/frontend.md). localStorage wird NUR bei explizitem Opt-in
// ("Angemeldet bleiben"-Haken im Login) verwendet, damit die App ein
// Schließen/Neustarten übersteht (bis das JWT abläuft).
//
// Invariante: Der Token liegt immer in genau EINEM der beiden Stores – nie in
// beiden gleichzeitig. So bleibt die "remember"-Entscheidung eindeutig.
const KEY = 'token'

// Liest den Token unabhängig vom Ablageort (persistent zuerst, dann Session).
export function getToken() {
  return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY)
}

// Beim Login: Ablageort anhand des "Angemeldet bleiben"-Wunsches wählen.
export function persistToken(token, remember) {
  if (remember) {
    localStorage.setItem(KEY, token)
    sessionStorage.removeItem(KEY)
  } else {
    sessionStorage.setItem(KEY, token)
    localStorage.removeItem(KEY)
  }
}

// Bei Token-Erneuerung (2FA-Verify, Passwort-Wechsel, Setup-Auto-Login) den
// bestehenden Ablageort beibehalten – kein erneutes Nachfragen nötig.
export function refreshToken(token) {
  const remember = localStorage.getItem(KEY) !== null
  persistToken(token, remember)
}

// Beim Logout / 401: Token aus BEIDEN Stores entfernen.
export function clearToken() {
  localStorage.removeItem(KEY)
  sessionStorage.removeItem(KEY)
}
