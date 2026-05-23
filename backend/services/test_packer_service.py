# p3portal.org
from __future__ import annotations

import io
import zipfile

import pytest

from backend.services.packer_service import save_template_zip

# meta.yaml referenced by HCL filename `test_template.pkr.hcl` (stem must match PackerMeta requirements)
_VALID_META = """\
name: Test Template
description: A test packer template for security regression tests
"""

_VALID_HCL = """\
source "proxmox-iso" "test" {}
build { sources = ["source.proxmox-iso.test"] }
"""


def _make_zip(*extra_entries: tuple[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("meta.yaml", _VALID_META)
        zf.writestr("test_template.pkr.hcl", _VALID_HCL)
        for entry_name, content in extra_entries:
            zf.writestr(zipfile.ZipInfo(entry_name), content)
    return buf.getvalue()


def test_save_template_zip_rejects_absolute_path(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.packer_service.settings.packer_dir", str(tmp_path))
    zip_bytes = _make_zip(("/etc/pwned", "should not land here"))
    with pytest.raises(ValueError, match="Absolute path"):
        save_template_zip(zip_bytes)


def test_save_template_zip_rejects_backslash_absolute(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.packer_service.settings.packer_dir", str(tmp_path))
    zip_bytes = _make_zip(("\\windows\\system32\\evil", "x"))
    with pytest.raises(ValueError, match="Absolute path"):
        save_template_zip(zip_bytes)


def test_save_template_zip_rejects_dotdot_traversal(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.packer_service.settings.packer_dir", str(tmp_path))
    zip_bytes = _make_zip(("../outside", "x"))
    with pytest.raises(ValueError, match=r"Ungültiger Pfad|Path traversal"):
        save_template_zip(zip_bytes)


def test_save_template_zip_accepts_valid_zip(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.packer_service.settings.packer_dir", str(tmp_path))
    zip_bytes = _make_zip(("http/preseed.cfg", "preseed content"))
    template_id = save_template_zip(zip_bytes)
    assert template_id == "test_template"
    assert (tmp_path / "test_template" / "meta.yaml").exists()
    assert (tmp_path / "test_template" / "test_template.pkr.hcl").exists()
    assert (tmp_path / "test_template" / "http" / "preseed.cfg").read_text() == "preseed content"
