# p3portal.org
"""Tests für backend/core/secret_masking.py (PROJ-67 Phase 1)."""
import pytest

from backend.core.secret_masking import mask_login_body, mask_sensitive_body, safe_log_field


class TestMaskSensitiveBody:
    def test_url_encoded_password(self):
        body = "username=admin&password=supersecret&realm=pam"
        result = mask_sensitive_body(body)
        assert "supersecret" not in result
        assert "password=<redacted>" in result
        assert "username=admin" in result

    def test_url_encoded_passwd(self):
        body = "user=foo&passwd=mypass123"
        result = mask_sensitive_body(body)
        assert "mypass123" not in result
        assert "passwd=<redacted>" in result

    def test_url_encoded_kennwort(self):
        body = "user=foo&KENNWORT=geheim"
        result = mask_sensitive_body(body)
        assert "geheim" not in result
        assert "KENNWORT=<redacted>" in result

    def test_json_password_field(self):
        import json
        body = json.dumps({"username": "admin", "password": "hunter2"})
        result = mask_sensitive_body(body)
        data = json.loads(result)
        assert data["password"] == "<redacted>"
        assert data["username"] == "admin"

    def test_json_token_field(self):
        import json
        body = json.dumps({"token": "abc123", "action": "run"})
        result = mask_sensitive_body(body)
        data = json.loads(result)
        assert data["token"] == "<redacted>"
        assert data["action"] == "run"

    def test_empty_body(self):
        assert mask_sensitive_body("") == ""

    def test_plain_text_no_sensitive(self):
        body = "some=value&other=stuff"
        assert mask_sensitive_body(body) == body

    def test_no_plaintext_password_in_result(self):
        body = "username=admin&password=PlainTextLeak&realm=pam"
        result = mask_sensitive_body(body)
        assert "PlainTextLeak" not in result

    def test_json_nested_secret(self):
        import json
        body = json.dumps({"config": {"password": "nested_secret"}})
        result = mask_sensitive_body(body)
        data = json.loads(result)
        assert data["config"]["password"] == "<redacted>"


class TestMaskLoginBody:
    def test_access_ticket_path(self):
        result = mask_login_body("/api2/json/access/ticket", "user=admin&password=secret")
        assert result == "<login-body-redacted>"

    def test_access_ticket_with_trailing_slash(self):
        result = mask_login_body("/nodes/pve/access/ticket/", "password=x")
        assert result == "<login-body-redacted>"

    def test_other_path_uses_mask_sensitive(self):
        result = mask_login_body("/api2/json/nodes", "password=secret")
        assert "password=<redacted>" in result
        assert "secret" not in result

    def test_empty_path(self):
        result = mask_login_body("", "password=secret")
        assert "secret" not in result

    def test_empty_body(self):
        assert mask_login_body("/access/ticket", "") == "<login-body-redacted>"


class TestSafeLogField:
    def test_newline_escaped(self):
        assert safe_log_field("line1\nline2") == r"line1\nline2"

    def test_carriage_return_escaped(self):
        assert safe_log_field("line1\rline2") == r"line1\rline2"

    def test_tab_escaped(self):
        assert safe_log_field("col1\tcol2") == r"col1\tcol2"

    def test_empty_string(self):
        assert safe_log_field("") == ""

    def test_clean_string_unchanged(self):
        assert safe_log_field("hello world") == "hello world"
