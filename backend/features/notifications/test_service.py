# p3portal.org
"""PROJ-65: Tests für Notification Hub – severity.py und schemas.py."""
from __future__ import annotations

import pytest

from backend.features.notifications.severity import (
    BELL_SEVERITIES,
    max_severity,
    severity_rank,
)
from backend.features.notifications.schemas import (
    MarkReadRequest,
    NotificationItem,
    NotificationSummary,
)
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# severity_rank
# ---------------------------------------------------------------------------

def test_severity_rank_ordering():
    assert severity_rank("critical") > severity_rank("warn")
    assert severity_rank("warn") > severity_rank("info")
    assert severity_rank("info") > severity_rank("success")


def test_severity_rank_unknown():
    assert severity_rank("unknown") == 0


# ---------------------------------------------------------------------------
# max_severity
# ---------------------------------------------------------------------------

def test_max_severity_returns_highest():
    assert max_severity(["info", "critical", "warn"]) == "critical"


def test_max_severity_excludes_success():
    assert max_severity(["success"]) is None


def test_max_severity_empty():
    assert max_severity([]) is None


def test_max_severity_warn_only():
    assert max_severity(["warn", "info"]) == "warn"


def test_max_severity_mixed_with_success():
    assert max_severity(["success", "warn"]) == "warn"


# ---------------------------------------------------------------------------
# BELL_SEVERITIES
# ---------------------------------------------------------------------------

def test_bell_severities_excludes_success():
    assert "success" not in BELL_SEVERITIES
    assert "critical" in BELL_SEVERITIES
    assert "warn" in BELL_SEVERITIES
    assert "info" in BELL_SEVERITIES


# ---------------------------------------------------------------------------
# MarkReadRequest validation
# ---------------------------------------------------------------------------

def test_mark_read_request_valid():
    req = MarkReadRequest(source="announcement", source_ids=["1", "2"])
    assert req.source == "announcement"
    assert len(req.source_ids) == 2


def test_mark_read_request_empty_list_invalid():
    with pytest.raises(Exception):
        MarkReadRequest(source="announcement", source_ids=[])


def test_mark_read_request_too_many_ids_invalid():
    with pytest.raises(Exception):
        MarkReadRequest(source="event", source_ids=[str(i) for i in range(201)])


def test_mark_read_request_invalid_source():
    with pytest.raises(Exception):
        MarkReadRequest(source="invalid_source", source_ids=["1"])


# ---------------------------------------------------------------------------
# NotificationItem schema
# ---------------------------------------------------------------------------

def test_notification_item_construction():
    from backend.features.notifications.schemas import NotificationLink
    item = NotificationItem(
        source="announcement",
        source_id="42",
        severity="warn",
        title="Test",
        summary=None,
        created_at=datetime.now(timezone.utc),
        read=False,
        link=NotificationLink(route="/announcements", modal=None, params={}),
        meta={},
    )
    assert item.source == "announcement"
    assert item.severity == "warn"
    assert item.read is False


# ---------------------------------------------------------------------------
# NotificationSummary
# ---------------------------------------------------------------------------

def test_notification_summary_construction():
    s = NotificationSummary(
        alerts=3,
        announcements=1,
        events=0,
        total=4,
        max_severity="critical",
    )
    assert s.total == 4
    assert s.max_severity == "critical"


def test_notification_summary_no_severity():
    s = NotificationSummary(
        alerts=0,
        announcements=0,
        events=0,
        total=0,
        max_severity=None,
    )
    assert s.max_severity is None
