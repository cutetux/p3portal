# p3portal.org
"""PROJ-45: pytest-Tests für den Groups-Router.

Testet: Happy-Path, 403-Pfade, 409 Name-Konflikt, 400 Proxmox-User-Block,
Basis-Limit-Reject, Member-Add/Remove, Owner-Lifecycle.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.groups.router import router
from backend.core.plus_protocol import plus_behavior

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_OPERATOR_TOKEN = create_access_token("operator", role="operator")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_MANAGE_TOKEN = create_access_token(
    "manager",
    auth_type="local",
    role="operator",
    portal_permissions=["manage_groups"],
)


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _create_local_user(client, username: str, role: str = "operator") -> dict:
    """Seed a local user directly via the DB for test setup."""
    from backend.db.database import get_db
    from sqlalchemy import text
    from datetime import datetime, timezone
    import hashlib

    pw_hash = hashlib.sha256(b"testpassword123").hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        result = await db.execute(
            text(
                "INSERT INTO local_users (username, password_hash, role, active, created_at, "
                "portal_permissions) VALUES (:u, :pw, :role, 1, :now, '[]') RETURNING id"
            ),
            {"u": username, "pw": pw_hash, "role": role, "now": now},
        )
        user_id = result.fetchone()[0]
        await db.commit()
    return {"id": user_id, "username": username, "role": role}


# ── Auth guards ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_groups_unauthenticated(client):
    r = await client.get("/api/groups")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_groups_forbidden_viewer(client):
    r = await client.get("/api/groups", headers={"Authorization": f"Bearer {_VIEWER_TOKEN}"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_list_groups_forbidden_operator(client):
    r = await client.get("/api/groups", headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_create_group_forbidden_operator(client):
    r = await client.post(
        "/api/groups",
        json={"name": "TestGruppe"},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


# ── Happy path: admin ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_groups_empty_admin(client):
    r = await client.get("/api/groups", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_group_admin(client):
    r = await client.post(
        "/api/groups",
        json={"name": "Web-Team", "description": "Frontend-Entwickler", "tags": ["web", "react"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Web-Team"
    assert body["description"] == "Frontend-Entwickler"
    assert body["tags"] == ["web", "react"]
    assert body["owner_user_id"] is None
    assert body["member_count"] == 0
    assert body["created_by"] == "admin"
    assert "id" in body
    assert body["members"] == []


@pytest.mark.asyncio
async def test_create_group_with_manage_permission(client):
    r = await client.post(
        "/api/groups",
        json={"name": "DevOps"},
        headers={"Authorization": f"Bearer {_MANAGE_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["created_by"] == "manager"


# ── Name validation ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_name_too_short(client):
    r = await client.post(
        "/api/groups",
        json={"name": "A"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_group_name_too_long(client):
    r = await client.post(
        "/api/groups",
        json={"name": "X" * 65},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_group_name_trimmed(client):
    r = await client.post(
        "/api/groups",
        json={"name": "  TrimMe  "},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["name"] == "TrimMe"


# ── Duplicate name (AC-3, case-insensitive) ───────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_duplicate_name_409(client):
    await client.post(
        "/api/groups",
        json={"name": "Infrastruktur"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.post(
        "/api/groups",
        json={"name": "infrastruktur"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 409


# ── Tag validation (AC-17, AC-18) ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_group_too_many_tags(client):
    r = await client.post(
        "/api/groups",
        json={"name": "TagTest", "tags": [f"tag{i}" for i in range(11)]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_group_tag_too_long(client):
    r = await client.post(
        "/api/groups",
        json={"name": "TagTest2", "tags": ["a" * 33]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_group_duplicate_tags_deduplicated(client):
    r = await client.post(
        "/api/groups",
        json={"name": "DedupeGroup", "tags": ["Alpha", "alpha", "ALPHA"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 201
    assert r.json()["tags"] == ["Alpha"]


# ── GET /api/groups/{id} ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_group_not_found(client):
    r = await client.get("/api/groups/9999", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_group_detail(client):
    create_r = await client.post(
        "/api/groups",
        json={"name": "DetailGroup"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.get(f"/api/groups/{group_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200
    assert r.json()["id"] == group_id
    assert r.json()["members"] == []


# ── PUT /api/groups/{id} ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_group_name(client):
    create_r = await client.post(
        "/api/groups",
        json={"name": "OldName"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.put(
        f"/api/groups/{group_id}",
        json={"name": "NewName"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "NewName"


@pytest.mark.asyncio
async def test_update_group_not_found(client):
    r = await client.put(
        "/api/groups/9999",
        json={"name": "Whatever"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_group_rename_conflict(client):
    await client.post(
        "/api/groups",
        json={"name": "Alpha"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    create_r = await client.post(
        "/api/groups",
        json={"name": "Beta"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.put(
        f"/api/groups/{group_id}",
        json={"name": "alpha"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 409


# ── DELETE /api/groups/{id} ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_group(client):
    create_r = await client.post(
        "/api/groups",
        json={"name": "DeleteMe"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.delete(f"/api/groups/{group_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 204

    get_r = await client.get(f"/api/groups/{group_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert get_r.status_code == 404


@pytest.mark.asyncio
async def test_delete_group_not_found(client):
    r = await client.delete("/api/groups/9999", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 404


# ── Members: add / remove ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_and_remove_member(client):
    user = await _create_local_user(client, "alice")
    create_r = await client.post(
        "/api/groups",
        json={"name": "MemberTest"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]

    add_r = await client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": user["id"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert add_r.status_code == 201
    assert add_r.json()["username"] == "alice"

    detail_r = await client.get(f"/api/groups/{group_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert detail_r.json()["member_count"] == 1
    assert len(detail_r.json()["members"]) == 1

    remove_r = await client.delete(
        f"/api/groups/{group_id}/members/{user['id']}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert remove_r.status_code == 204

    detail_r2 = await client.get(f"/api/groups/{group_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert detail_r2.json()["member_count"] == 0


@pytest.mark.asyncio
async def test_add_member_duplicate_409(client):
    user = await _create_local_user(client, "bob")
    create_r = await client.post(
        "/api/groups",
        json={"name": "DupeMemberTest"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]

    await client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": user["id"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": user["id"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_add_member_group_not_found(client):
    user = await _create_local_user(client, "charlie")
    r = await client.post(
        "/api/groups/9999/members",
        json={"user_id": user["id"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_add_member_user_not_found(client):
    create_r = await client.post(
        "/api/groups",
        json={"name": "NoUserTest"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": 99999},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_remove_member_not_found(client):
    create_r = await client.post(
        "/api/groups",
        json={"name": "RemoveNotFoundTest"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.delete(
        f"/api/groups/{group_id}/members/9999",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 404


# ── Core limit (AC-7) ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_core_limit_3_groups(client, monkeypatch):
    monkeypatch.setattr(plus_behavior, "get_max_groups", lambda: 3)

    for i in range(3):
        r = await client.post(
            "/api/groups",
            json={"name": f"Group{i}"},
            headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
        )
        assert r.status_code == 201

    r = await client.post(
        "/api/groups",
        json={"name": "FourthGroup"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 403


# ── Tags pool (AC-19) ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tags_pool(client):
    await client.post(
        "/api/groups",
        json={"name": "TagPool1", "tags": ["devops", "linux"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    await client.post(
        "/api/groups",
        json={"name": "TagPool2", "tags": ["python", "linux"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    r = await client.get("/api/groups/tags", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    assert r.status_code == 200
    tags = r.json()["tags"]
    assert "devops" in tags
    assert "linux" in tags
    assert "python" in tags
    assert tags.count("linux") == 1  # deduplicated


# ── Owner lifecycle (AC-12, AC-15) ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_and_clear_owner(client):
    user = await _create_local_user(client, "owner_user")
    create_r = await client.post(
        "/api/groups",
        json={"name": "OwnerGroup"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]

    r = await client.put(
        f"/api/groups/{group_id}",
        json={"owner_user_id": user["id"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 200
    assert r.json()["owner_user_id"] == user["id"]
    assert r.json()["owner_username"] == "owner_user"

    r2 = await client.put(
        f"/api/groups/{group_id}",
        json={"clear_owner": True},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r2.status_code == 200
    assert r2.json()["owner_user_id"] is None


# ── Audit log entries ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_audit_log_group_created(client):
    from backend.services.audit_service import get_audit_logs
    await client.post(
        "/api/groups",
        json={"name": "AuditCreate"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    logs = await get_audit_logs(event_type="group_created")
    assert any("AuditCreate" in (l.get("detail") or "") for l in logs)


@pytest.mark.asyncio
async def test_audit_log_group_deleted(client):
    from backend.services.audit_service import get_audit_logs
    create_r = await client.post(
        "/api/groups",
        json={"name": "AuditDelete"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    await client.delete(f"/api/groups/{group_id}", headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"})
    logs = await get_audit_logs(event_type="group_deleted")
    assert any("AuditDelete" in (l.get("detail") or "") for l in logs)


@pytest.mark.asyncio
async def test_audit_log_member_added_removed(client):
    from backend.services.audit_service import get_audit_logs
    user = await _create_local_user(client, "audit_member")
    create_r = await client.post(
        "/api/groups",
        json={"name": "AuditMember"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]

    await client.post(
        f"/api/groups/{group_id}/members",
        json={"user_id": user["id"]},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    added_logs = await get_audit_logs(event_type="group_member_added")
    assert len(added_logs) >= 1

    await client.delete(
        f"/api/groups/{group_id}/members/{user['id']}",
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    removed_logs = await get_audit_logs(event_type="group_member_removed")
    assert len(removed_logs) >= 1


# ── Self-service join-request (AC-35: 503 until PROJ-50) ─────────────────────

@pytest.mark.asyncio
async def test_join_request_503_until_proj50(client):
    create_r = await client.post(
        "/api/groups",
        json={"name": "JoinReqGroup"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    group_id = create_r.json()["id"]
    r = await client.post(
        f"/api/groups/{group_id}/join-request",
        json={"reason": "Ich möchte mitmachen"},
        headers={"Authorization": f"Bearer {_ADMIN_TOKEN}"},
    )
    assert r.status_code == 503
