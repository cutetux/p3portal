# p3portal.org
"""PROJ-71: Root conftest – DB-Backend-Auswahl + requires_docker-Marker.

Verwendung:
    SECRET_KEY=<key> pytest                      # SQLite (default)
    SECRET_KEY=<key> pytest --db=postgres        # PostgreSQL via testcontainers
    TEST_DB=postgres SECRET_KEY=<key> pytest     # via Env-Var

Marker:
    @pytest.mark.requires_docker  – Skip wenn kein Docker/Podman-Daemon verfügbar
"""
from __future__ import annotations

import os
import pytest

# Registriert db/conftest_postgres.py als pytest-Plugin damit dessen
# session-scoped Fixtures (configure_pg_url, _postgres_container) geladen werden.
# pytest auto-discovers nur Dateien namens conftest.py – dieses Plugin muss
# explizit registriert werden.
pytest_plugins = ["db.conftest_postgres"]


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--db",
        action="store",
        default=os.environ.get("TEST_DB", "sqlite"),
        choices=["sqlite", "postgres"],
        help="DB-Backend für Tests: sqlite (default) oder postgres (testcontainers)",
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "requires_docker: Test benötigt Docker/Podman-Daemon (testcontainers). "
        "Wird geskippt wenn kein Daemon verfügbar.",
    )
    config.addinivalue_line(
        "markers",
        "plus_only: Test läuft nur im Plus-Image (requires Plus-Edition hooks).",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Skip requires_docker- und plus_only-Tests je nach Build-Umgebung."""
    if not _plus_code_present():
        skip_plus = pytest.mark.skip(
            reason="Plus-Code nicht im Build (Core-only) – plus_only Test übersprungen"
        )
        for item in items:
            if item.get_closest_marker("plus_only"):
                item.add_marker(skip_plus)

    if config.getoption("--db") != "postgres":
        return

    if _check_docker_available():
        return

    skip_docker = pytest.mark.skip(
        reason="Docker/Podman-Daemon nicht verfügbar – kein --db=postgres ohne Container-Runtime"
    )
    for item in items:
        if item.get_closest_marker("requires_docker"):
            item.add_marker(skip_docker)


def _plus_code_present() -> bool:
    """Erkennt ob das Build Plus-Module enthält (nicht nur Stubs).

    Heuristik: in Core-Builds wird backend/plus/ via inject_core_plus_stubs()
    auf eine einzige __init__.py reduziert. Echter Plus-Code enthält Module
    wie alerts_plus.py, approvals/, scheduled_jobs/.
    """
    from pathlib import Path
    plus_dir = Path(__file__).parent / "plus"
    if not plus_dir.is_dir():
        return False
    sentinel = plus_dir / "alerts_plus.py"
    return sentinel.is_file()


def _check_docker_available() -> bool:
    """Prüft ob Docker oder Podman erreichbar ist."""
    import shutil
    import subprocess

    for cmd in (["docker", "info"], ["podman", "info"]):
        if shutil.which(cmd[0]) is None:
            continue
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=5)
            if result.returncode == 0:
                return True
        except (subprocess.TimeoutExpired, OSError):
            continue
    return False


@pytest.fixture(autouse=True)
def _cleanup_plus_behavior_singleton():
    """PROJ-60: Entfernt Test-Patches vom plus_behavior-Singleton nach jedem Test.

    PROJ-71 Phase 2: Diese Fixture existierte bisher NUR in der Repo-Root-
    conftest.py. Reale Test-Läufe und die CI laufen aber als ``cd backend &&
    pytest`` (rootdir=backend/) → die Root-conftest.py oberhalb wird **nie**
    geladen → der Cleanup lief nie → ein Test, der ``plus_behavior`` via
    monkeypatch auf Plus-Verhalten setzt, vergiftete nachfolgende ``*_no_plus``/
    ``*_core``/``*_404_in_core``-Tests (Core-Erwartung scheitert) = die 26
    "Baseline"-Failures, die den blockierenden ``-x``-CI-Job rot machten.

    ``monkeypatch.setattr(plus_behavior, name, ...)`` schreibt direkt ins
    ``__dict__`` des Dispatchers; das undo setzt den alten Wert (bound method)
    statt zu löschen. Diese Fixture löscht alle Test-Attribute sauber, sodass
    kein Singleton-State zwischen Tests leckt. (Identisch zur Root-Variante; die
    Root-conftest.py bleibt für Repo-Root-Läufe bestehen.)
    """
    _protected = {"_core", "_active"}
    yield
    try:
        from backend.core.plus_protocol import plus_behavior
        extras = [k for k in vars(plus_behavior) if k not in _protected]
        for attr in extras:
            try:
                object.__delattr__(plus_behavior, attr)
            except AttributeError:
                pass
    except ImportError:
        pass


@pytest.fixture(autouse=True)
def _isolate_global_app_state():
    """CI (S726): neutralisiert geteilten globalen App-Zustand nach JEDEM Test.

    Die CI („Backend Tests", sqlite+postgres, ``pytest -x``) war dauerhaft rot durch
    **ordnungsabhängige Test-Verschmutzung**: ein Test hinterließ globalen Zustand,
    ein Folgetest sah ihn als „kaputt". Welcher Test kippte, hing an der
    Collection-Reihenfolge (CI: ``test_scope_wiring``; lokal-Core: cluster/admin-Login).

    Zwei Leck-Vektoren, beide hier an EINER Stelle geschlossen (statt N schludrige
    Tests einzeln zu fixen):

    1. ``backend.main.app.dependency_overrides`` – viele Router-Tests setzen
       ``app.dependency_overrides[get_current_user] = …``. Wirft der Testkörper vor
       dem ``clear()``, leckt das Override → Folgetests laufen mit gefälschtem User.
    2. ``_SCOPED_ENDPOINTS`` (Modul-Global in ``features/api_surface/default_deny.py``)
       – ``build_scoped_endpoint_inventory(app)`` macht ``.clear()`` + neu; ein Test,
       der es mit einer Mini-App aufruft, überschreibt die globale Registry für alle
       folgenden Türsteher-Tests.

    Nur aktiv, wenn ``backend.main`` bereits importiert wurde (kein Force-Import,
    damit reine Service-/Unit-Tests nicht unnötig die App hochziehen).
    """
    import sys
    yield
    main_mod = sys.modules.get("backend.main")
    if main_mod is None:
        return
    app = getattr(main_mod, "app", None)
    if app is None:
        return
    try:
        app.dependency_overrides.clear()
    except Exception:
        pass
    try:
        from backend.features.api_surface.default_deny import build_scoped_endpoint_inventory
        build_scoped_endpoint_inventory(app)
    except Exception:
        pass
    # 3. Login-Rate-Limiter (In-Memory-Dict pro IP in routers/auth.py). Ohne Reset
    #    summieren sich Login-Versuche über Tests → ein späterer Login-Test bekommt
    #    429 statt 200 (order-abhängig).
    try:
        from backend.routers import auth as _auth
        _auth._login_attempts.clear()
    except Exception:
        pass
    # 4. Cluster-Ressourcen-Cache (PROJ-33, In-Memory TTL). Ein Test, der den Cache
    #    mit gemockten Node-Daten füllt, lässt einen Folgetest stale Daten sehen.
    try:
        from backend.services.cluster_cache_service import cluster_cache
        cluster_cache.invalidate_all()
    except Exception:
        pass
    # 5. Config-Cache (In-Memory-Dict aus portal_config). Ein Test, der Node-/Token-
    #    Config setzt, lässt Folgetests stale Werte sehen (z.B. cluster/nodes). Leeren
    #    → nächster get_config_sync fällt sauber auf DB/settings zurück. (Trial-Flags
    #    werden separat im License-Testmodul zurückgesetzt, s. dort.)
    try:
        from backend.services import config_service as _cfg
        _cfg._cache.clear()
    except Exception:
        pass
