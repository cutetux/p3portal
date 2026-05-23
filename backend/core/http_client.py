# p3portal.org
"""PROJ-67 Phase 1 – F-002: Sicherer HTTP-Client für ausgehende Requests.

Ersetzt alle direkten `httpx.AsyncClient(verify=False)`-Aufrufe in Services.
Bietet DNS-Rebinding-Schutz und Privat-IP-Blockierung für Webhook-URLs.
"""
from __future__ import annotations

import ipaddress
import logging
import socket
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

# RFC1918 + Loopback + Link-Local + Multicast Netzwerke
_BLOCKED_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("127.0.0.0/8"),       # IPv4 Loopback
    ipaddress.ip_network("10.0.0.0/8"),         # RFC1918
    ipaddress.ip_network("172.16.0.0/12"),      # RFC1918
    ipaddress.ip_network("192.168.0.0/16"),     # RFC1918
    ipaddress.ip_network("169.254.0.0/16"),     # Link-Local
    ipaddress.ip_network("224.0.0.0/4"),        # Multicast
    ipaddress.ip_network("::1/128"),            # IPv6 Loopback
    ipaddress.ip_network("fc00::/7"),           # IPv6 ULA
    ipaddress.ip_network("fe80::/10"),          # IPv6 Link-Local
    ipaddress.ip_network("ff00::/8"),           # IPv6 Multicast
    ipaddress.ip_network("0.0.0.0/8"),          # Unspecified
]


def is_private_ip(ip_str: str) -> bool:
    """Prüft ob eine IP-Adresse in einem blockierten Netzwerk liegt."""
    try:
        addr = ipaddress.ip_address(ip_str)
        return any(addr in net for net in _BLOCKED_NETWORKS)
    except ValueError:
        return True  # Ungültige IP → blockieren


def _resolve_host(hostname: str) -> str | None:
    """Löst einen Hostnamen synchron auf. Gibt None bei Fehler zurück."""
    try:
        results = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC)
        if results:
            return results[0][4][0]  # erste aufgelöste IP
        return None
    except (socket.gaierror, OSError):
        return None


def validate_webhook_url(
    url: str,
    allow_http: bool = False,
    allowlist_patterns: list[str] | None = None,
) -> None:
    """Validiert eine Webhook-URL synchron.

    Prüft:
    - Schema (https:// erforderlich, http:// nur wenn allow_http=True)
    - Privat-IP-Blockierung (DNS-Resolve → IP-Check)
    - Strict-Allowlist (wenn allowlist_patterns nicht leer)

    Raises:
        ValueError: wenn die URL ungültig, privat oder nicht in der Allowlist ist
    """
    if not url:
        raise ValueError("Webhook-URL darf nicht leer sein")

    parsed = urlparse(url)

    # Schema-Prüfung
    if parsed.scheme == "https":
        pass  # immer erlaubt
    elif parsed.scheme == "http":
        if not allow_http:
            raise ValueError(
                "Webhook-URLs müssen HTTPS verwenden. "
                "HTTP ist nur mit explizitem allow_http-Flag erlaubt."
            )
    else:
        raise ValueError(
            f"Ungültiges URL-Schema '{parsed.scheme}'. Nur https (und http mit Flag) erlaubt."
        )

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("Webhook-URL enthält keinen Hostnamen")

    # DNS-Resolve + Privat-IP-Check
    resolved_ip = _resolve_host(hostname)
    if resolved_ip is None:
        raise ValueError(f"Hostname '{hostname}' konnte nicht aufgelöst werden")

    if is_private_ip(resolved_ip):
        raise ValueError(
            f"Webhook-URL zeigt auf eine private/interne IP ({resolved_ip}). "
            "Aus Sicherheitsgründen werden interne Netzwerke blockiert."
        )

    # Strict-Allowlist (nur wenn nicht leer = aktiv)
    if allowlist_patterns:
        if not _matches_allowlist(hostname, allowlist_patterns):
            raise ValueError(
                f"Hostname '{hostname}' ist nicht in der Webhook-Allowlist. "
                "Bitte den Hostnamen in System Settings → Sicherheit → Webhook-Allowlist hinzufügen."
            )


def _matches_allowlist(hostname: str, patterns: list[str]) -> bool:
    """Prüft ob ein Hostname einem der Allowlist-Patterns entspricht.

    Patterns können exakte Hostnamen oder Wildcard-Suffixe (*.example.com) sein.
    """
    hostname = hostname.lower()
    for pattern in patterns:
        pattern = pattern.lower().strip()
        if not pattern:
            continue
        if pattern.startswith("*."):
            suffix = pattern[1:]  # z.B. ".example.com"
            if hostname.endswith(suffix) or hostname == suffix.lstrip("."):
                return True
        else:
            if hostname == pattern:
                return True
    return False


def check_dns_rebinding(hostname: str, expected_allowed: bool = True) -> tuple[bool, str]:
    """DNS-Rebinding-Schutz: Löst Hostname auf und prüft ob IP privat ist.

    Gibt (is_safe, resolved_ip) zurück.
    Wird beim Dispatch unmittelbar vor dem HTTP-Request aufgerufen.
    """
    resolved_ip = _resolve_host(hostname)
    if resolved_ip is None:
        return False, ""
    if is_private_ip(resolved_ip):
        return False, resolved_ip
    return True, resolved_ip


@asynccontextmanager
async def secure_outbound_client(
    verify: bool = True,
    timeout: float = 10.0,
):
    """Async context manager für sichere ausgehende HTTP-Requests.

    Ersetzt direktes `httpx.AsyncClient(verify=False)`.
    verify=True ist der sichere Default.
    """
    async with httpx.AsyncClient(verify=verify, timeout=timeout) as client:
        yield client
