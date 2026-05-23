# Feature-Module-Struktur (PROJ-52)

<!-- p3portal.org -->

## Überblick

Neue Features (PROJ-45+) leben hier als eigenständige Module. Jedes Modul enthält
alle feature-spezifischen Dateien: Router, Service, Schemas und Tests.

Bestandsfeatures (PROJ-1..42) liegen weiterhin in `backend/routers/` und
`backend/services/`. Sie werden **nicht aktiv migriert** (Strangler-Fig-Prinzip).
Dieses Nebeneinander ist gewollt und kein Bug.

---

## Verzeichniskonvention

```
backend/features/<feature_name>/
  __init__.py       ← exportiert `router` für main.py
  router.py         ← FastAPI-Router, prefix/tags innen definiert
  service.py        ← Business-Logik (async functions, kein Router-State)
  schemas.py        ← Pydantic-v2 Request/Response-Modelle
  test_router.py    ← pytest-Tests für Endpunkte
  test_service.py   ← pytest-Tests für Service-Logik
```

`<feature_name>` ist `snake_case`, z.B. `groups`, `pools`, `node_scope_permissions`.

---

## Was rein – was raus

| Code-Art | Ort | Grund |
|----------|-----|-------|
| Feature-Router | `features/<name>/router.py` | Zum Feature gehörig |
| Feature-Service | `features/<name>/service.py` | Zum Feature gehörig |
| Feature-Pydantic-Schemas | `features/<name>/schemas.py` | Zum Feature gehörig |
| Feature-Tests | `features/<name>/test_*.py` | Co-located |
| DB-Tabellendefinitionen | `backend/db/models.py` | Zentrale Schema-Quelle |
| Geteilte Pydantic-Modelle | `backend/models/` | Kein Duplikat |
| Audit, Proxmox, Auth-Deps | `backend/services/`, `backend/core/` | Projektweit |
| Plus-Hooks | `backend/plus/hooks.py` + `*_plus.py` | PROJ-43-Layer |

---

## Neues Feature anlegen

1. Kopiere `backend/features/_template/` → `backend/features/<name>/`
2. Ersetze alle `FEATURE`-Platzhalter in den Dateien
3. Trage DB-Tabellen in `backend/db/models.py` ein (zentral!)
4. Registriere den Router in `backend/main.py` im Block **"Feature-Module routers"**
5. Prefix: `/api/<name-plural>` (z.B. `/api/groups`)

---

## Router-Registrierung (main.py)

```python
# Feature-Module routers (PROJ-52+)
from backend.features.groups import router as groups_router
app.include_router(groups_router)
```

Explizite Registrierung statt Auto-Discovery: Klarheit > Magie.

---

## Cross-Cutting-Endpoints (z.B. `/api/me/<feature>`, `/api/vms/...`)

Manche Feature-Endpoints gehören thematisch in andere URL-Pfade als der Haupt-Prefix:

- `GET /api/me/pools` — "Welche Pools sehe ich?" (gehört thematisch zu `/me`, nicht zu `/pools`)
- `POST /api/vms/{vmid}/pool` — "Diese VM einem Pool zuordnen" (gehört zu `/vms`)

**Regel:** Solche Cross-Cutting-Endpoints dürfen als **zusätzliche Router** im selben Feature-Modul liegen. Beispiel (`backend/features/pools/router.py`):

```python
router      = APIRouter(prefix="/api/pools", tags=["pools"])  # Haupt-Router
me_router   = APIRouter(prefix="/api/me",    tags=["pools"])  # /me/pools
vms_router  = APIRouter(prefix="/api/vms",   tags=["pools"])  # /vms/.../pool
```

Alle Router werden in `main.py` einzeln registriert. Das Feature bleibt
Single-Source-of-Truth für seine Endpoints — egal unter welchem URL-Pfad sie hängen.

**Was NICHT geht:** Endpoints eines anderen Features in `backend/routers/<other>.py`
oder `backend/features/<other>/router.py` einhaken. Cross-Cutting-Endpoints bleiben
**immer im Feature-Modul**, das die Daten besitzt.

---

## Testen

```bash
# Feature isoliert testen
pytest backend/features/<name>/

# Alles testen (Feature-Module + Bestand)
pytest backend/
```

---

## Plus-Kompatibilität (PROJ-43)

PROJ-43 und PROJ-52 sind orthogonal:

- **Basis-Anteil**: `backend/features/<name>/` + `frontend/src/features/<name>/`
- **Plus-Anteil**: `backend/plus/<name>_plus.py` + `frontend/src/plus/<Name>/`
- PROJ-43-Regel hat Vorrang: Plus-Code darf nicht in `features/` landen.

Feature-Module rufen Plus-Hooks über den globalen `hooks`-Proxy auf,
kein direkter Plus-Import aus Feature-Modulen.

---

## Cross-Feature-Imports

Erlaubt: `from backend.features.groups.service import get_group` (service.py-Export).  
Verboten: Direktzugriff auf `router.py` oder `schemas.py` eines anderen Features.
