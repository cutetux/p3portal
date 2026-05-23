# p3portal.org
"""PROJ-XX: Business-Logik für das FEATURE-Modul.

Keine Router-State-Imports hier. Nur async-Funktionen, die von router.py
und ggf. anderen Features (via service.py-Export) aufgerufen werden.
"""
from __future__ import annotations

from backend.db.database import get_db


async def create_feature(name: str) -> dict:
    """Erstellt ein neues FEATURE-Objekt. Gibt das erstellte Objekt zurück."""
    async with get_db() as db:
        result = await db.execute(
            "INSERT INTO features (name) VALUES (?) RETURNING id, name",
            (name,),
        )
        row = await result.fetchone()
        await db.commit()
        return {"id": row[0], "name": row[1]}


async def get_feature(feature_id: int) -> dict | None:
    """Gibt ein FEATURE-Objekt anhand der ID zurück oder None."""
    async with get_db() as db:
        result = await db.execute(
            "SELECT id, name FROM features WHERE id = ?",
            (feature_id,),
        )
        row = await result.fetchone()
        if not row:
            return None
        return {"id": row[0], "name": row[1]}
