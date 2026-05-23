# p3portal.org
from __future__ import annotations

from pydantic import BaseModel, Field


class ThemeVars(BaseModel):
    model_config = {"extra": "allow"}


class ThemeResponse(BaseModel):
    id: str
    name: str
    is_builtin: bool
    vars: dict[str, str]


class ThemeUpload(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    variables: dict[str, str]


class ThemeEditorRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    variables: dict[str, str]


class SetDefaultRequest(BaseModel):
    theme_id: str


class PreferencesResponse(BaseModel):
    theme_id: str | None
    lang_code: str | None


class PreferencesRequest(BaseModel):
    theme_id: str | None = None
    lang_code: str | None = None
