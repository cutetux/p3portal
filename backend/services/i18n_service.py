# p3portal.org
from __future__ import annotations

import re
from pathlib import Path

import yaml

from backend.core.config import settings

_ASSETS_DIR = Path(__file__).parent.parent / "assets" / "translations"
_BUILTIN_CODES = {"de", "en"}
_BUILTIN_NAMES = {"de": "Deutsch", "en": "English"}

MAX_LANG_BYTES = 500 * 1024  # 500 KB


def _data_dir() -> Path:
    p = Path(settings.data_dir) / "translations"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_lang_code(code: str) -> str:
    return re.sub(r"[^a-z0-9_-]", "", code.lower())[:10]


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def _strip_meta(data: dict) -> dict:
    """Remove internal _lang_* keys before returning to client."""
    return {k: v for k, v in data.items() if not k.startswith("_")}


def list_languages() -> list[dict]:
    langs: list[dict] = []
    # Built-in
    for code in sorted(_BUILTIN_CODES):
        langs.append({
            "code": code,
            "name": _BUILTIN_NAMES.get(code, code),
            "is_builtin": True,
        })
    # Custom (from data dir)
    data_dir = _data_dir()
    for f in sorted(data_dir.glob("*.yml")):
        code = f.stem
        if code in _BUILTIN_CODES:
            continue
        try:
            data = _load_yaml(f)
            name = data.get("_lang_name", code.upper())
        except Exception:
            name = code.upper()
        langs.append({"code": code, "name": name, "is_builtin": False})
    return langs


def get_translation(lang_code: str) -> dict | None:
    """Returns translation dict for lang_code, or None if not found."""
    code = _safe_lang_code(lang_code)
    if code in _BUILTIN_CODES:
        path = _ASSETS_DIR / f"{code}.yml"
    else:
        path = _data_dir() / f"{code}.yml"

    if not path.exists():
        return None
    data = _load_yaml(path)
    return _strip_meta(data)


def upload_translation(filename: str, content: bytes, uploader: str) -> dict:
    """Validate and persist a custom language YAML. Returns language metadata."""
    stem = Path(filename).stem
    lang_code = _safe_lang_code(stem)

    if not lang_code:
        raise ValueError("Ungültiger Sprachcode aus Dateiname")
    if lang_code in _BUILTIN_CODES:
        raise ValueError(f"Built-in Sprache '{lang_code}' kann nicht überschrieben werden")

    try:
        data = yaml.safe_load(content.decode("utf-8")) or {}
    except Exception as exc:
        raise ValueError(f"Ungültiges YAML: {exc}") from exc

    if not isinstance(data, dict):
        raise ValueError("YAML muss ein Mapping (dict) auf oberster Ebene sein")

    lang_name = data.get("_lang_name", lang_code.upper())
    dest = _data_dir() / f"{lang_code}.yml"
    dest.write_bytes(content)

    return {"code": lang_code, "name": lang_name, "is_builtin": False}


def delete_translation(lang_code: str) -> bool:
    """Delete a custom translation. Returns False if not found."""
    code = _safe_lang_code(lang_code)
    if code in _BUILTIN_CODES:
        raise ValueError("Built-in Sprachen können nicht gelöscht werden")
    path = _data_dir() / f"{code}.yml"
    if not path.exists():
        return False
    path.unlink()
    return True
