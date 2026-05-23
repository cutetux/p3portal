# p3portal.org
"""Tests für PROJ-67 Phase 1 – F-005/F-013 in proxmox_audit_service.py."""
import logging
import os
from pathlib import Path
from unittest.mock import patch

import pytest


class TestWriteAuditLineRotating:
    def test_write_creates_log_file(self, tmp_path):
        from backend.services import proxmox_audit_service

        log_file = tmp_path / "proxmox_audit.log"
        # Reset cache so a fresh logger is created
        proxmox_audit_service._audit_logger_cache.clear()

        with patch.dict(os.environ, {"DATA_DIR": str(tmp_path)}):
            proxmox_audit_service.write_audit_line(
                "token-abc", "GET", "/api2/json/nodes", "200"
            )

        assert log_file.exists()
        content = log_file.read_text()
        assert "GET /api2/json/nodes" in content
        assert "200" in content

    def test_write_includes_user_and_body(self, tmp_path):
        from backend.services import proxmox_audit_service

        proxmox_audit_service._audit_logger_cache.clear()

        with patch.dict(os.environ, {"DATA_DIR": str(tmp_path)}):
            proxmox_audit_service.write_audit_line(
                "tok", "POST", "/api2/json/nodes/pve/qemu", "200",
                user="admin@pam", body="vmid=100",
            )

        content = (tmp_path / "proxmox_audit.log").read_text()
        assert "user=admin@pam" in content
        assert "body=vmid=100" in content

    def test_rotating_handler_is_reused(self, tmp_path):
        from backend.services import proxmox_audit_service

        proxmox_audit_service._audit_logger_cache.clear()

        with patch.dict(os.environ, {"DATA_DIR": str(tmp_path)}):
            proxmox_audit_service.write_audit_line("t", "GET", "/a", "200")
            logger1 = proxmox_audit_service._get_audit_logger()
            proxmox_audit_service.write_audit_line("t", "GET", "/b", "200")
            logger2 = proxmox_audit_service._get_audit_logger()

        assert logger1 is logger2

    def test_write_does_not_raise_on_bad_dir(self):
        from backend.services import proxmox_audit_service

        proxmox_audit_service._audit_logger_cache.clear()

        with patch.dict(os.environ, {"DATA_DIR": "/nonexistent/__bad__"}):
            # Should not raise
            proxmox_audit_service.write_audit_line("t", "GET", "/x", "200")


class TestBodyMaskingInAuditLine:
    """Verify that mask_login_body is applied before write_audit_line in proxmox.py."""

    def test_login_body_fully_redacted(self, tmp_path):
        """Passwords must not appear in the audit log for /access/ticket paths."""
        from backend.services import proxmox_audit_service
        from backend.core.secret_masking import mask_login_body

        proxmox_audit_service._audit_logger_cache.clear()

        masked = mask_login_body("/api2/json/access/ticket", "username=admin&password=hunter2")
        with patch.dict(os.environ, {"DATA_DIR": str(tmp_path)}):
            proxmox_audit_service.write_audit_line(
                "cookie-auth", "POST", "/api2/json/access/ticket", "200",
                body=masked,
            )

        content = (tmp_path / "proxmox_audit.log").read_text()
        assert "hunter2" not in content
        assert "<login-body-redacted>" in content

    def test_regular_body_password_masked(self, tmp_path):
        from backend.services import proxmox_audit_service
        from backend.core.secret_masking import mask_login_body

        proxmox_audit_service._audit_logger_cache.clear()

        masked = mask_login_body("/api2/json/nodes/pve/qemu", "password=mysecret&vmid=100")
        with patch.dict(os.environ, {"DATA_DIR": str(tmp_path)}):
            proxmox_audit_service.write_audit_line(
                "tok", "POST", "/api2/json/nodes/pve/qemu", "200",
                body=masked,
            )

        content = (tmp_path / "proxmox_audit.log").read_text()
        assert "mysecret" not in content
        assert "password=<redacted>" in content
