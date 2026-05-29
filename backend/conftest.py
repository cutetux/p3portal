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
