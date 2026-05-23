# p3portal.org
"""Tests für backend/features/help/sanitizer.py"""
import pytest

from backend.features.help.sanitizer import compute_md5, validate_and_sanitize


# ── validate_and_sanitize ─────────────────────────────────────────────────────

class TestValidateAndSanitize:
    def test_valid_markdown_accepted(self):
        content = b"# Hilfe\n\n**Fetter Text** und `Code`.\n\n## Bedienung\n\n1. Schritt eins\n2. Schritt zwei\n"
        result = validate_and_sanitize(content)
        assert "# Hilfe" in result

    def test_empty_file_rejected(self):
        with pytest.raises(ValueError, match="leer"):
            validate_and_sanitize(b"")

    def test_too_large_rejected(self):
        big = b"x" * (200 * 1024 + 1)
        with pytest.raises(ValueError, match="groß"):
            validate_and_sanitize(big)

    def test_invalid_extension_rejected(self):
        with pytest.raises(ValueError, match="Dateiendung"):
            validate_and_sanitize(b"# Test", filename="doc.txt")

    def test_valid_md_extension_accepted(self):
        result = validate_and_sanitize(b"# Test", filename="help.md")
        assert result == "# Test"

    def test_valid_markdown_extension_accepted(self):
        result = validate_and_sanitize(b"# Test", filename="help.markdown")
        assert result == "# Test"

    def test_non_utf8_rejected(self):
        with pytest.raises(ValueError, match="Zeichenkodierung"):
            validate_and_sanitize(b"\xff\xfe ungueltig")

    # Bild-Ablehnung (AC-UPLOAD-9)
    def test_markdown_image_rejected(self):
        content = b"# Test\n\n![Screenshot](./img/screen.png)\n"
        with pytest.raises(ValueError, match="Bilder"):
            validate_and_sanitize(content)

    def test_html_img_rejected(self):
        content = b"# Test\n\n<img src='screen.png' />\n"
        with pytest.raises(ValueError, match="Bilder"):
            validate_and_sanitize(content)

    # Gefährliche HTML (AC-MD-6)
    def test_script_tag_rejected(self):
        content = b"# Test\n<script>alert(1)</script>\n"
        with pytest.raises(ValueError, match="HTML-Elemente"):
            validate_and_sanitize(content)

    def test_iframe_tag_rejected(self):
        content = b"# Test\n<iframe src='http://evil.com'></iframe>\n"
        with pytest.raises(ValueError, match="HTML-Elemente"):
            validate_and_sanitize(content)

    def test_object_tag_rejected(self):
        content = b"# Test\n<object data='x.swf'></object>\n"
        with pytest.raises(ValueError, match="HTML-Elemente"):
            validate_and_sanitize(content)

    def test_embed_tag_rejected(self):
        content = b"# Test\n<embed src='x.swf' />\n"
        with pytest.raises(ValueError, match="HTML-Elemente"):
            validate_and_sanitize(content)

    def test_onclick_handler_rejected(self):
        content = b"<div onclick='evil()'>Click</div>\n"
        with pytest.raises(ValueError, match="Event-Handler"):
            validate_and_sanitize(content)

    def test_onload_handler_rejected(self):
        content = b"<img onload='evil()' />\n"
        # img wird durch Image-Check abgefangen
        with pytest.raises(ValueError):
            validate_and_sanitize(content)

    def test_javascript_link_rejected(self):
        content = b"[Click](javascript:alert(1))\n"
        # Markdown-Link mit javascript: Schema
        content_html = b'<a href="javascript:alert(1)">Click</a>\n'
        with pytest.raises(ValueError, match="javascript"):
            validate_and_sanitize(content_html)

    def test_code_block_with_script_content_accepted(self):
        # Codeblöcke mit "gefährlichem" Inhalt müssen akzeptiert werden (AC-MD-6 Klarstellung)
        content = b"```bash\ncurl http://evil.example.com\n```\n"
        result = validate_and_sanitize(content)
        assert "curl" in result

    def test_markdown_table_accepted(self):
        content = b"| Spalte A | Spalte B |\n|---|---|\n| Wert 1 | Wert 2 |\n"
        result = validate_and_sanitize(content)
        assert "Spalte A" in result

    def test_external_link_accepted(self):
        content = b"Mehr Infos: [Proxmox Docs](https://pve.proxmox.com/wiki/)\n"
        result = validate_and_sanitize(content)
        assert "Proxmox Docs" in result


# ── compute_md5 ────────────────────────────────────────────────────────────────

class TestComputeMd5:
    def test_deterministic(self):
        assert compute_md5("hello") == compute_md5("hello")

    def test_different_content_different_hash(self):
        assert compute_md5("hello") != compute_md5("world")

    def test_known_hash(self):
        # MD5("") = d41d8cd98f00b204e9800998ecf8427e
        assert compute_md5("") == "d41d8cd98f00b204e9800998ecf8427e"

    def test_length_32(self):
        assert len(compute_md5("test")) == 32
