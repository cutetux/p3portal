# p3portal.org
"""PROJ-57: Server-seitige Sanitisierung und Validierung für Help-Override-Uploads.

Defense-in-Depth-Ansatz:
1. Format-Prüfung: Größe, UTF-8, nicht leer
2. Bild-Ablehnung (AC-UPLOAD-9): Markdown-![...] + HTML-<img>
3. Gefährliche HTML-Muster ablehnen (AC-UPLOAD-4 / AC-MD-6):
   <script>, <iframe>, <object>, <embed>, on*=, javascript:, data: URLs
4. Rückgabe des (unkompromittierten) Markdown-Inhalts als String

bleach ist NICHT als Pflicht-Abhängigkeit eingebunden – die regex-basierte
Prüfung ist für Markdown-Inhalte ausreichend und vermeidet eine Deprecation-
Abhängigkeit (bleach wurde 2023 als „final" markiert).
"""
from __future__ import annotations

import re

# ── Limits ────────────────────────────────────────────────────────────────────

MAX_SIZE_BYTES = 200 * 1024  # 200 KB
ALLOWED_EXTENSIONS = {".md", ".markdown"}

# ── Gefährliche Muster ────────────────────────────────────────────────────────

# Erkennt HTML-Tags die XSS ermöglichen
_DANGEROUS_TAGS = re.compile(
    r"<\s*(script|iframe|object|embed|base|form|meta|link)\b",
    re.IGNORECASE,
)

# Erkennt inline on*= Event-Handler (onclick=, onload= etc.)
_ON_HANDLER = re.compile(r"\bon\w+\s*=", re.IGNORECASE)

# Erkennt javascript: oder data: URI-Schemes in href/src-Attributen
_JS_LINK = re.compile(r"""(?:href|src)\s*=\s*['"]?\s*(?:javascript|data)\s*:""", re.IGNORECASE)

# Erkennt Markdown-Bildsyntax: ![Alt](url)
_MD_IMAGE = re.compile(r"!\[.*?\]\(.+?\)", re.DOTALL)

# Erkennt HTML <img …>
_HTML_IMG = re.compile(r"<\s*img\b", re.IGNORECASE)


# ── Haupt-Validierungsfunktion ────────────────────────────────────────────────

def validate_and_sanitize(
    content_bytes: bytes,
    filename: str = "",
) -> str:
    """Validiert und gibt den Markdown-Inhalt als String zurück.

    Raises:
        ValueError: Bei Verstößen gegen Größe, Kodierung, Bilder oder gefährliche Inhalte.
    """
    # 1. Größe
    if len(content_bytes) == 0:
        raise ValueError("Datei darf nicht leer sein.")
    if len(content_bytes) > MAX_SIZE_BYTES:
        raise ValueError(
            f"Datei zu groß ({len(content_bytes) // 1024} KB). "
            f"Maximal {MAX_SIZE_BYTES // 1024} KB erlaubt."
        )

    # 2. Datei-Endung (wenn Dateiname bekannt)
    if filename:
        suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if suffix not in ALLOWED_EXTENSIONS:
            raise ValueError(
                f"Ungueltiger Dateiendung '{suffix}'. Nur .md / .markdown erlaubt."
            )

    # 3. UTF-8-Dekodierung
    try:
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError(
            "Ungültige Zeichenkodierung. Datei muss UTF-8 kodiert sein."
        )

    # 4. Bild-Ablehnung (AC-UPLOAD-9)
    if _MD_IMAGE.search(content) or _HTML_IMG.search(content):
        raise ValueError(
            "Bilder in eigenen Hilfen sind nicht erlaubt. "
            "Bitte beschreibe Screenshots textuell oder reiche einen Repo-PR ein."
        )

    # 5. Gefährliche HTML-Muster
    if _DANGEROUS_TAGS.search(content):
        raise ValueError(
            "Unerlaubte HTML-Elemente gefunden (<script>, <iframe>, <object>, <embed> etc.)."
        )
    if _ON_HANDLER.search(content):
        raise ValueError(
            "Inline-Event-Handler (on*=) sind nicht erlaubt."
        )
    if _JS_LINK.search(content):
        raise ValueError(
            "javascript:- und data:-URLs sind nicht erlaubt."
        )

    return content


def compute_md5(content: str) -> str:
    """Berechnet den MD5-Hash des Inhalts (für Veraltungs-Detektion, kein Crypto-Bedarf)."""
    import hashlib
    return hashlib.md5(content.encode("utf-8")).hexdigest()
