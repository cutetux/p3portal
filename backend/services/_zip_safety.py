# p3portal.org
"""ZIP extraction guard rails.

Independent implementation written from the bug description only — see
memory/feedback_no_external_code_paste.md for the policy. The chosen
approach is deliberately different from the inline pattern that was
previously used: pre-validation pass using PurePosixPath, secondary
verification via os.path.commonpath, chunked stream-based file copy
through zipfile.ZipFile.open(), and a dedicated UnsafeZipMember
exception.
"""
from __future__ import annotations

import os
import zipfile
from pathlib import Path, PurePosixPath
from typing import Iterable

_STREAM_CHUNK_BYTES = 64 * 1024


class UnsafeZipMember(ValueError):
    """Raised when a ZIP entry would write outside the intended target."""


def _path_components_are_safe(member: str) -> tuple[bool, str]:
    """Decide whether a ZIP entry name can be extracted safely.

    Returns ``(True, "")`` when safe, otherwise ``(False, reason)``.
    Rejects empty names, absolute paths in either POSIX or Windows form,
    any ``..`` segment, and Windows drive-letter prefixes (``C:\\foo``)
    that pathlib leaves intact under POSIX semantics.
    """
    if member is None:
        return False, "entry name is None"
    cleaned = member.strip()
    if not cleaned:
        return False, "empty entry name"
    normalised = cleaned.replace("\\", "/")
    posix = PurePosixPath(normalised)
    if posix.is_absolute():
        return False, "entry resolves to an absolute path"
    for component in posix.parts:
        if component == "..":
            return False, "entry contains a parent reference (..)"
        if not component:
            return False, "entry contains an empty segment"
        if len(component) >= 2 and component[1] == ":" and component[0].isalpha():
            return False, "entry contains a Windows drive letter prefix"
    return True, ""


def _verify_inside_root(target_root_str: str, candidate_str: str) -> bool:
    """Independent second check via os.path.commonpath."""
    try:
        common = os.path.commonpath([target_root_str, candidate_str])
    except ValueError:
        # commonpath raises on mixed drives / inputs on Windows
        return False
    return common == target_root_str


def extract_zip_safely(
    archive: zipfile.ZipFile,
    target_root: Path,
    name_filter: Iterable[str] | None = None,
    name_strip_prefix: str = "",
) -> int:
    """Extract entries of ``archive`` into ``target_root``.

    Only entries whose name starts with ``name_strip_prefix`` are
    considered. The prefix is removed before joining onto ``target_root``.
    Returns the number of files written. Directory entries are not
    counted; their parents are created implicitly as needed.

    Raises :class:`UnsafeZipMember` on the first unsafe entry and aborts.
    The caller is responsible for cleaning up any partially extracted
    directory on failure.
    """
    target_root_str = str(target_root.resolve())
    entries = list(name_filter) if name_filter is not None else archive.namelist()

    files_written = 0
    for raw_name in entries:
        if not raw_name.startswith(name_strip_prefix):
            continue

        ok, reason = _path_components_are_safe(raw_name)
        if not ok:
            raise UnsafeZipMember(
                f"refused archive entry {raw_name!r}: {reason}"
            )

        relative_str = raw_name[len(name_strip_prefix):]
        if not relative_str:
            continue

        # Re-validate the stripped suffix too — guards against an entry
        # whose name starts with a benign prefix but turns absolute after
        # the prefix is removed.
        ok, reason = _path_components_are_safe(relative_str)
        if not ok:
            raise UnsafeZipMember(
                f"refused archive entry {raw_name!r} after prefix strip: {reason}"
            )

        candidate_str = os.path.normpath(
            os.path.join(target_root_str, relative_str)
        )
        if not _verify_inside_root(target_root_str, candidate_str):
            raise UnsafeZipMember(
                f"refused archive entry {raw_name!r}: would escape target directory"
            )

        if raw_name.endswith("/"):
            os.makedirs(candidate_str, exist_ok=True)
            continue

        parent_dir = os.path.dirname(candidate_str)
        if parent_dir:
            os.makedirs(parent_dir, exist_ok=True)

        # Stream-copy via zipfile.ZipFile.open() — avoids loading the full
        # entry into memory and uses a different I/O path than the prior
        # implementation.
        with archive.open(raw_name, "r") as src, open(candidate_str, "wb") as dst:
            while True:
                chunk = src.read(_STREAM_CHUNK_BYTES)
                if not chunk:
                    break
                dst.write(chunk)
        files_written += 1

    return files_written
