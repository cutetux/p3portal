# Feature-Modul-Struktur (PROJ-52)

<!-- p3portal.org -->

## Überblick

Neue Features (PROJ-45+) leben hier als eigenständige Module. Jedes Modul enthält
Page, Komponenten, Hooks und API-Client des Features.

Bestandsfeatures (PROJ-1..42) liegen weiterhin in `frontend/src/pages/` und
`frontend/src/components/`. Sie werden **nicht aktiv migriert** (Strangler-Fig).

---

## Verzeichniskonvention

```
frontend/src/features/<feature_name>/
  Page.jsx           ← Hauptseite (geroutet via App.jsx)
  Page.test.jsx      ← Vitest-Tests für die Page (optional, empfohlen)
  api.js             ← axios-Wrapper für alle API-Calls des Features
  components/        ← feature-spezifische Komponenten
  hooks/             ← feature-spezifische React-Query-Hooks
```

`<feature_name>` ist `camelCase` auf Dateisystem-Ebene, z.B. `groups`, `pools`.

---

## Was rein – was raus

| Code-Art | Ort | Grund |
|----------|-----|-------|
| Feature-Page | `features/<name>/Page.jsx` | Zum Feature gehörig |
| Feature-Komponenten | `features/<name>/components/` | Zum Feature gehörig |
| Feature-Hooks | `features/<name>/hooks/` | Zum Feature gehörig |
| Feature-API-Client | `features/<name>/api.js` | Zum Feature gehörig |
| Geteilte UI-Bausteine | `src/components/common/` | Projektweit |
| Plus-only-Komponenten | `src/plus/<Feature>/` | PROJ-43-Regel hat Vorrang |
| Sidebar-Eintrag | `src/components/AppLayout/Sidebar.jsx` | Projektweit |
| i18n-Strings | `src/locales/{de,en}.json` | Projektweit |

---

## Neues Feature anlegen

1. Kopiere `frontend/src/features/_template/` → `frontend/src/features/<name>/`
2. Ersetze alle `FEATURE`-Platzhalter in den Dateien
3. Registriere die Route in `frontend/src/App.jsx`
4. Trage ggf. einen Sidebar-Eintrag in `Sidebar.jsx` ein
5. Füge i18n-Strings in `locales/de.json` und `locales/en.json` hinzu

---

## Plus-Kompatibilität (PROJ-43)

PROJ-43 und PROJ-52 sind orthogonal:

- **Basis-Anteil**: `features/<name>/` (diese Ebene)
- **Plus-only-Anteil**: `plus/<Name>/` (PROJ-43-Layer)
- Plus-Komponenten via `PlusComponents.Registry` (React.lazy + Suspense) einbinden

Die PROJ-43-Regel hat Vorrang: Plus-Code darf nicht in `features/` landen.

---

## Testen

```bash
# Feature isoliert testen
npm test -- features/<feature_name>

# Alles testen
npm test
```
