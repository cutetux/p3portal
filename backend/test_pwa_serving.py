# p3portal.org
"""Tests für PROJ-108: Installierbare PWA – Auslieferung von Manifest + Icons.

Kern-Risiko: Das gebaute Frontend wird vom SPA-Catch-All (``GET /{full_path:path}``)
serviert. Ohne explizite Routen würden ``/manifest.webmanifest`` und die Icon-Pfade als
``index.html`` (HTML) zurückkommen → PWA nicht installierbar. Diese Tests verifizieren, dass
die additiven Routen korrekt greifen, den richtigen Content-Type liefern und der bestehende
SPA-Fallback unverändert bleibt.

Voraussetzung: ``frontend/dist`` ist gebaut (die Static-Routen sind nur dann gemountet).
Ohne Build werden die Tests übersprungen (kein CI-Flake).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main

_DIST = Path(main.__file__).parent.parent / "frontend" / "dist"

pytestmark = pytest.mark.skipif(
    not (_DIST / "manifest.webmanifest").is_file(),
    reason="frontend/dist nicht gebaut – PWA-Static-Routen nicht gemountet",
)


@pytest.fixture()
def client() -> TestClient:
    return TestClient(main.app)


def _is_html(content: bytes) -> bool:
    head = content[:300].lower()
    return head.strip().startswith(b"<!doctype") or b"<html" in head


# --- AC-1 / AC-2: Manifest --------------------------------------------------

def test_manifest_served_not_html(client: TestClient):
    r = client.get("/manifest.webmanifest")
    assert r.status_code == 200
    assert not _is_html(r.content), "Catch-All hat index.html statt Manifest geliefert"


def test_manifest_content_type(client: TestClient):
    r = client.get("/manifest.webmanifest")
    assert "application/manifest+json" in r.headers.get("content-type", "")


def test_manifest_is_valid_json_with_required_fields(client: TestClient):
    data = json.loads(client.get("/manifest.webmanifest").content)
    # AC-2: Pflichtfelder
    assert data["name"] == "P3 Portal"
    assert data["short_name"] == "P3"
    assert data["start_url"] == "/"
    assert data["scope"] == "/"
    assert data["display"] == "standalone"
    assert data["theme_color"] == "#ea580c"
    assert "background_color" in data


def test_manifest_declares_192_512_and_maskable(client: TestClient):
    icons = json.loads(client.get("/manifest.webmanifest").content)["icons"]
    sizes = {i["sizes"] for i in icons}
    assert "192x192" in sizes and "512x512" in sizes
    purposes = {i.get("purpose") for i in icons}
    assert "maskable" in purposes and "any" in purposes
    # Alle referenzierten Icon-Quellen sind absolute Root-Pfade
    assert all(i["src"].startswith("/") for i in icons)


# --- AC-3: Icons ------------------------------------------------------------

@pytest.mark.parametrize(
    "path", ["/pwa-192.png", "/pwa-512.png", "/pwa-maskable-512.png"]
)
def test_icon_served_as_png(client: TestClient, path: str):
    r = client.get(path)
    assert r.status_code == 200
    assert r.headers.get("content-type", "") == "image/png"
    assert not _is_html(r.content)
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", "keine gültige PNG-Signatur"


def test_manifest_icon_paths_all_resolve(client: TestClient):
    """Jede im Manifest deklarierte Icon-URL muss real ausgeliefert werden."""
    icons = json.loads(client.get("/manifest.webmanifest").content)["icons"]
    for icon in icons:
        r = client.get(icon["src"])
        assert r.status_code == 200, f"{icon['src']} nicht erreichbar"
        assert r.headers.get("content-type", "") == "image/png"


# --- AC-8: keine Regression am bestehenden Serving --------------------------

def test_spa_catchall_still_returns_html(client: TestClient):
    r = client.get("/dashboard")
    assert r.status_code == 200
    assert _is_html(r.content), "SPA-Fallback darf weiterhin index.html liefern"


def test_favicon_route_unchanged(client: TestClient):
    r = client.get("/favicon.png")
    assert r.status_code == 200
    assert r.headers.get("content-type", "") == "image/png"


def test_api_paths_are_not_swallowed_by_pwa_routes(client: TestClient):
    """Unbekannter /api/-Pfad bleibt 404 (nicht index.html) – Regression-Guard."""
    r = client.get("/api/__does_not_exist__")
    assert r.status_code == 404
