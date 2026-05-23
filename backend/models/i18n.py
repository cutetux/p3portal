# p3portal.org
from __future__ import annotations

from pydantic import BaseModel


class LanguageResponse(BaseModel):
    code: str
    name: str
    is_builtin: bool


class SetDefaultLangRequest(BaseModel):
    lang_code: str
