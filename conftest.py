# p3portal.org
import os

import pytest

# Provide required env vars before pydantic-settings loads config at import time.
os.environ.setdefault("PROXMOX_HOST", "https://test.example.com:8006")
os.environ.setdefault("SECRET_KEY", "test-secret-key-minimum-32-chars-ok!")


def pytest_configure(config):
    # PROJ-60: Markiert Tests, die backend.plus.* direkt referenzieren.
    # Pure-Core-Build führt diese Tests nicht aus: pytest -m "not plus_only"
    config.addinivalue_line("markers", "plus_only: Tests die direkt Plus-Code referenzieren (nicht im Pure-Core-Build)")


@pytest.fixture(autouse=True)
def _cleanup_plus_behavior_singleton():
    """PROJ-60: Entfernt Test-Patches von plus_behavior nach jedem Test.

    monkeypatch.setattr(plus_behavior, name, ...) setzt ein Attribut direkt
    im __dict__ des Dispatchers. Beim undo setzt monkeypatch es auf den alten
    Wert (eine bound-Methode), statt es zu löschen. Dieser Fixture löscht alle
    Test-Attribute sauber, sodass kein Singleton-State zwischen Tests leckt.
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
