from __future__ import annotations

from datetime import datetime, timezone

from app.main import _parse_event_row


def test_parse_event_row_maps_columns() -> None:
    row = (
        42,
        datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc),
        73.5,
        81.2,
        True,
        True,
        18.0,
        {"rule": 12.4},
        {"packet": 55.0},
        "critical",
        "Trigger lockout",
        "mvtec-feature-ocsvm-v1",
        ["reason-a", "reason-b"],
        92.1,
        True,
        11.3,
        True,
        100.0,
        "external-vision-signal",
        "external-security-signal",
    )

    parsed = _parse_event_row(row)

    assert parsed["id"] == 42
    assert parsed["created_at"] == "2026-01-01T12:00:00+00:00"
    assert parsed["process_score"] == 73.5
    assert parsed["network_score"] == 81.2
    assert parsed["process_anomaly"] is True
    assert parsed["network_alert"] is True
    assert parsed["risk_level"] == "critical"
    assert parsed["process_components"] == {"rule": 12.4}
    assert parsed["network_components"] == {"packet": 55.0}
    assert parsed["reasons"] == ["reason-a", "reason-b"]
    assert parsed["process_source"] == "external-vision-signal"
    assert parsed["network_source"] == "external-security-signal"
