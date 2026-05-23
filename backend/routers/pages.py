# p3portal.org
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status

from backend.core.deps import get_current_user

router = APIRouter(prefix="/api/pages", tags=["pages"])

_SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
_PAGES_DIR = Path(__file__).parent.parent / "page_descriptions"


@router.get("/{page_id}")
async def get_page_description(
    page_id: str,
    _: str = Depends(get_current_user),
) -> dict:
    """Return Markdown content of docs/pages/{page_id}.md."""
    if not _SAFE_ID.match(page_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid page ID")
    md_file = _PAGES_DIR / f"{page_id}.md"
    if not md_file.is_file():
        return {"content": None}
    return {"content": md_file.read_text(encoding="utf-8")}
