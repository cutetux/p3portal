# p3portal.org
"""PROJ-65: Severity-Konstanten und Vergleichs-Helfer."""
from __future__ import annotations

# Sortier-Rang: höhere Zahl = höhere Priorität
SEVERITY_RANK: dict[str, int] = {
    "critical": 4,
    "warn":     3,
    "info":     2,
    "success":  1,
}

# Alle gültigen Werte
VALID_SEVERITIES = frozenset(SEVERITY_RANK.keys())

# Severities, die die Glockenfarbe beeinflussen (success zählt nicht per Spec D-4)
BELL_SEVERITIES = ("critical", "warn", "info")


def severity_rank(severity: str) -> int:
    """Rang für Sortierung. Unbekannte Werte landen am Ende."""
    return SEVERITY_RANK.get(severity, 0)


def max_severity(severities: list[str]) -> str | None:
    """Höchste Severity aus einer Liste – ignoriert 'success', gibt None bei Leerliste zurück."""
    candidates = [s for s in severities if s in SEVERITY_RANK and s != "success"]
    if not candidates:
        return None
    return max(candidates, key=severity_rank)
