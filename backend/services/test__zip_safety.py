# p3portal.org
"""Unit tests for the ZIP-extraction safety helper.

Independent test suite — written from the security requirement only,
without referring to externally-suggested test vectors.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from backend.services._zip_safety import (
    UnsafeZipMember,
    _path_components_are_safe,
    extract_zip_safely,
)


def _build_archive_with(*entries: tuple[str, bytes]) -> zipfile.ZipFile:
    """Assemble an in-memory ZIP with the given (name, payload) tuples."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w") as zf:
        for entry_name, payload in entries:
            info = zipfile.ZipInfo(filename=entry_name)
            zf.writestr(info, payload)
    buffer.seek(0)
    return zipfile.ZipFile(buffer, mode="r")


# ── _path_components_are_safe unit tests ────────────────────────────────────


class TestPathComponentsAreSafe:
    @pytest.mark.parametrize(
        "good_name",
        [
            "playbook.yml",
            "roles/common/tasks/main.yml",
            "http/preseed.cfg",
            "subdir/.hidden",
            "name with spaces.txt",
        ],
    )
    def test_accepts_plain_relative(self, good_name: str) -> None:
        ok, why = _path_components_are_safe(good_name)
        assert ok, f"expected accept for {good_name!r}, got: {why}"
        assert why == ""

    @pytest.mark.parametrize(
        ("bad_name", "needle"),
        [
            ("/absolute/posix", "absolute"),
            ("//double-slash", "absolute"),
            ("/etc/cron.d/whatever", "absolute"),
            ("../escape", "parent"),
            ("nested/../escape", "parent"),
            ("..", "parent"),
            ("C:/windows/path", "drive"),
            ("z:/anywhere", "drive"),
            ("", "empty"),
            ("   ", "empty"),
        ],
    )
    def test_rejects_unsafe(self, bad_name: str, needle: str) -> None:
        ok, why = _path_components_are_safe(bad_name)
        assert not ok, f"expected reject for {bad_name!r}, but accepted"
        assert needle in why, f"reason {why!r} did not mention {needle!r}"

    def test_handles_none_input(self) -> None:
        ok, why = _path_components_are_safe(None)  # type: ignore[arg-type]
        assert not ok
        assert "None" in why or "empty" in why


# ── extract_zip_safely integration tests ────────────────────────────────────


class TestExtractZipSafely:
    def test_extracts_plain_files(self, tmp_path: Path) -> None:
        archive = _build_archive_with(
            ("alpha.txt", b"first"),
            ("beta/gamma.txt", b"second"),
        )
        written = extract_zip_safely(archive, tmp_path)
        assert written == 2
        assert (tmp_path / "alpha.txt").read_bytes() == b"first"
        assert (tmp_path / "beta" / "gamma.txt").read_bytes() == b"second"

    def test_strips_prefix_when_requested(self, tmp_path: Path) -> None:
        archive = _build_archive_with(
            ("wrap/inner.txt", b"x"),
            ("wrap/sub/deep.txt", b"y"),
        )
        written = extract_zip_safely(
            archive, tmp_path, name_strip_prefix="wrap/"
        )
        assert written == 2
        assert (tmp_path / "inner.txt").read_bytes() == b"x"
        assert (tmp_path / "sub" / "deep.txt").read_bytes() == b"y"

    def test_rejects_absolute_unix_path(self, tmp_path: Path) -> None:
        archive = _build_archive_with(("/etc/cron.d/payload", b"x"))
        with pytest.raises(UnsafeZipMember) as info:
            extract_zip_safely(archive, tmp_path)
        assert "absolute" in str(info.value)
        # Nothing should have been written
        assert list(tmp_path.iterdir()) == []

    def test_rejects_absolute_windows_path(self, tmp_path: Path) -> None:
        archive = _build_archive_with(("\\windows\\system32\\evil", b"x"))
        with pytest.raises(UnsafeZipMember):
            extract_zip_safely(archive, tmp_path)
        assert list(tmp_path.iterdir()) == []

    def test_rejects_parent_traversal(self, tmp_path: Path) -> None:
        archive = _build_archive_with(("../escape", b"x"))
        with pytest.raises(UnsafeZipMember) as info:
            extract_zip_safely(archive, tmp_path)
        assert "parent" in str(info.value)

    def test_rejects_drive_letter(self, tmp_path: Path) -> None:
        archive = _build_archive_with(("D:/payload.txt", b"x"))
        with pytest.raises(UnsafeZipMember):
            extract_zip_safely(archive, tmp_path)

    def test_skips_entries_outside_filter(self, tmp_path: Path) -> None:
        archive = _build_archive_with(
            ("keep/a.txt", b"a"),
            ("ignore/b.txt", b"b"),
        )
        written = extract_zip_safely(
            archive, tmp_path, name_filter=["keep/a.txt"]
        )
        assert written == 1
        assert (tmp_path / "keep" / "a.txt").exists()
        assert not (tmp_path / "ignore").exists()

    def test_streaming_works_for_large_entry(self, tmp_path: Path) -> None:
        # ~256 KiB exercises the 64 KiB chunk loop several times.
        payload = b"P" * (256 * 1024)
        archive = _build_archive_with(("big.bin", payload))
        written = extract_zip_safely(archive, tmp_path)
        assert written == 1
        assert (tmp_path / "big.bin").read_bytes() == payload

    def test_aborts_on_first_unsafe_entry(self, tmp_path: Path) -> None:
        # Order matters here: the safe entry comes first and should land,
        # then the unsafe entry must abort *before* writing anything more.
        archive = _build_archive_with(
            ("safe.txt", b"ok"),
            ("/unsafe", b"nope"),
            ("also_safe.txt", b"never reached"),
        )
        with pytest.raises(UnsafeZipMember):
            extract_zip_safely(archive, tmp_path)
        assert (tmp_path / "safe.txt").exists()
        assert not (tmp_path / "also_safe.txt").exists()
