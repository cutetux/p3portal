# p3portal.org
"""Celery-App Bootstrap für P3 Portal.

Erstellt die Celery-Instanz und delegiert Task-Registrierung an Plus-Hooks.

Worker-Startbefehl (im celery-worker Container):
  celery -A backend.celery_app worker --beat -l info
"""
from __future__ import annotations

import logging
import os

from celery import Celery

logger = logging.getLogger(__name__)

VALKEY_URL = os.getenv("VALKEY_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "p3portal",
    broker=VALKEY_URL,
    backend=VALKEY_URL,
    include=["backend.celery_app"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    beat_schedule={},  # Beat-Tasks werden via Plus-Hooks registriert
)


# ── Plus-Selbstregistrierung im Worker-Prozess ───────────────────────────────
# Im celery-worker wird nur dieses Modul geladen, NICHT backend.main – daher
# muss backend.plus hier explizit importiert werden, sonst bleibt
# plus_behavior._active == None und die register_*_celery_tasks-Aufrufe unten
# fallen auf den Core-No-Op zurück (Plus-Image, aber Tasks nicht registriert).
# Pure-Core-Build (PROJ-69) hat backend/plus/ entfernt → ImportError → ok.
try:
    import backend.plus  # noqa: F401
except ImportError:
    logger.info("backend.plus nicht verfügbar – Core-Edition-Modus aktiv (Worker)")


# ── Plus-Hooks: Tasks registrieren ───────────────────────────────────────────

# PROJ-64: Approval-Expire-Task via Plus-Hook registrieren
try:
    from backend.core.plus_protocol import plus_behavior as _pb
    _pb.register_approval_celery_tasks(celery_app)
except Exception as _e:
    logger.warning("Approval-Celery-Tasks nicht verfügbar: %s", _e)

# PROJ-70: Scheduled-Job-Tasks via Plus-Hook registrieren
try:
    from backend.core.plus_protocol import plus_behavior as _pb2
    _pb2.register_scheduled_job_celery_tasks(celery_app)
except Exception as _e:
    logger.warning("Scheduled-Job-Celery-Tasks nicht verfügbar: %s", _e)
