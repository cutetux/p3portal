# p3portal.org
"""Tests für backend/core/http_client.py (PROJ-67 Phase 1)."""
import pytest

from backend.core.http_client import (
    _matches_allowlist,
    check_dns_rebinding,
    is_private_ip,
    validate_webhook_url,
)


class TestIsPrivateIp:
    def test_loopback_v4(self):
        assert is_private_ip("127.0.0.1")

    def test_rfc1918_10(self):
        assert is_private_ip("10.0.0.1")

    def test_rfc1918_172(self):
        assert is_private_ip("172.16.0.1")
        assert is_private_ip("172.31.255.255")

    def test_rfc1918_192(self):
        assert is_private_ip("192.168.1.1")

    def test_link_local(self):
        assert is_private_ip("169.254.0.1")

    def test_ipv6_loopback(self):
        assert is_private_ip("::1")

    def test_public_ip_allowed(self):
        assert not is_private_ip("8.8.8.8")

    def test_public_ip_cloudflare(self):
        assert not is_private_ip("1.1.1.1")

    def test_invalid_ip_blocked(self):
        assert is_private_ip("not-an-ip")


class TestMatchesAllowlist:
    def test_exact_match(self):
        assert _matches_allowlist("hooks.example.com", ["hooks.example.com"])

    def test_wildcard_match(self):
        assert _matches_allowlist("sub.example.com", ["*.example.com"])

    def test_wildcard_no_match_other_domain(self):
        assert not _matches_allowlist("sub.other.com", ["*.example.com"])

    def test_no_match_empty_list(self):
        assert not _matches_allowlist("example.com", [])

    def test_case_insensitive(self):
        assert _matches_allowlist("HOOKS.EXAMPLE.COM", ["hooks.example.com"])


class TestValidateWebhookUrl:
    def test_valid_https_public(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        validate_webhook_url("https://hooks.example.com/webhook")  # should not raise

    def test_http_without_flag_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        with pytest.raises(ValueError, match="HTTPS"):
            validate_webhook_url("http://example.com/hook")

    def test_http_with_flag_allowed(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        validate_webhook_url("http://example.com/hook", allow_http=True)

    def test_private_ip_blocked(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "192.168.1.1")
        with pytest.raises(ValueError, match="private"):
            validate_webhook_url("https://internal.lan/hook")

    def test_loopback_blocked(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "127.0.0.1")
        with pytest.raises(ValueError, match="private"):
            validate_webhook_url("https://localhost/hook")

    def test_empty_url_raises(self):
        with pytest.raises(ValueError, match="leer"):
            validate_webhook_url("")

    def test_invalid_scheme_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        with pytest.raises(ValueError, match="Schema"):
            validate_webhook_url("ftp://example.com/hook")

    def test_allowlist_match_passes(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        validate_webhook_url(
            "https://hooks.example.com/notify",
            allowlist_patterns=["hooks.example.com"],
        )

    def test_allowlist_no_match_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "1.2.3.4")
        with pytest.raises(ValueError, match="Allowlist"):
            validate_webhook_url(
                "https://other.com/notify",
                allowlist_patterns=["hooks.example.com"],
            )

    def test_dns_resolve_failure_raises(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: None)
        with pytest.raises(ValueError, match="aufgelöst"):
            validate_webhook_url("https://nonexistent.invalid/hook")


class TestCheckDnsRebinding:
    def test_public_ip_is_safe(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "8.8.8.8")
        safe, ip = check_dns_rebinding("dns.google")
        assert safe is True
        assert ip == "8.8.8.8"

    def test_private_ip_not_safe(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: "192.168.1.1")
        safe, ip = check_dns_rebinding("evil.lan")
        assert safe is False
        assert ip == "192.168.1.1"

    def test_resolve_failure(self, monkeypatch):
        monkeypatch.setattr("backend.core.http_client._resolve_host", lambda h: None)
        safe, ip = check_dns_rebinding("nxdomain.invalid")
        assert safe is False
        assert ip == ""
