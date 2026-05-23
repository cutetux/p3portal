# p3portal.org
"""PROJ-45: Pydantic-Schemas für das Groups-Modul."""
from __future__ import annotations

from pydantic import BaseModel, field_validator


class GroupCreateRequest(BaseModel):
    name: str
    description: str | None = None
    tags: list[str] = []
    owner_user_id: int | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Gruppenname muss mindestens 2 Zeichen lang sein")
        if len(v) > 64:
            raise ValueError("Gruppenname darf maximal 64 Zeichen lang sein")
        return v

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        if len(v) > 10:
            raise ValueError("Maximal 10 Tags pro Gruppe erlaubt")
        result: list[str] = []
        seen: set[str] = set()
        for tag in v:
            tag = tag.strip()
            if len(tag) > 32:
                raise ValueError("Ein Tag darf maximal 32 Zeichen lang sein")
            lower = tag.lower()
            if lower not in seen:
                seen.add(lower)
                result.append(tag)
        return result


class GroupUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    owner_user_id: int | None = None
    clear_owner: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Gruppenname muss mindestens 2 Zeichen lang sein")
        if len(v) > 64:
            raise ValueError("Gruppenname darf maximal 64 Zeichen lang sein")
        return v

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if len(v) > 10:
            raise ValueError("Maximal 10 Tags pro Gruppe erlaubt")
        result: list[str] = []
        seen: set[str] = set()
        for tag in v:
            tag = tag.strip()
            if len(tag) > 32:
                raise ValueError("Ein Tag darf maximal 32 Zeichen lang sein")
            lower = tag.lower()
            if lower not in seen:
                seen.add(lower)
                result.append(tag)
        return result


class MemberAddRequest(BaseModel):
    user_id: int


class MemberResponse(BaseModel):
    id: int
    username: str
    role: str
    added_at: str
    added_by: str


class GroupResponse(BaseModel):
    id: int
    name: str
    description: str | None
    tags: list[str]
    owner_user_id: int | None
    owner_username: str | None
    member_count: int
    created_at: str
    created_by: str


class GroupDetailResponse(GroupResponse):
    members: list[MemberResponse]


class TagsPoolResponse(BaseModel):
    tags: list[str]


class MyGroupEntry(BaseModel):
    id: int
    name: str
    owner_username: str | None
