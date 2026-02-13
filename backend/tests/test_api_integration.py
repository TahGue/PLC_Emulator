from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch


def test_health_endpoint_without_db(client) -> None:
    """Health endpoint should return a response even if DB is unavailable."""
    response = client.get("/health")
    # May fail DB check but should not crash
    assert response.status_code == 200
    body = response.json()
    assert "ok" in body


def test_metrics_endpoint_returns_prometheus_format(client) -> None:
    response = client.get("/metrics")
    assert response.status_code == 200
    text = response.text
    assert "analyzer_analyses_total" in text
    assert "analyzer_process_anomalies_total" in text
    assert "analyzer_network_alerts_total" in text
    assert "analyzer_vision_signals_ingested" in text
    assert "analyzer_security_signals_ingested" in text
    assert "analyzer_vision_signal_fresh" in text
    assert "analyzer_security_signal_fresh" in text


def test_metrics_counters_increment_after_signals(client) -> None:
    # Ingest a vision signal
    client.post("/signals/vision", json={
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "anomaly_score": 42.0,
        "defect_flag": False,
        "model_version": "test-v1",
        "inference_ms": 5.0,
        "source": "pytest",
    })

    # Ingest a security signal
    client.post("/signals/security", json={
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "packet_rate": 130.0,
        "burst_ratio": 0.2,
        "unauthorized_attempts": 0,
        "security_flag": False,
        "source": "pytest",
        "sample_window_seconds": 1.0,
    })

    response = client.get("/metrics")
    text = response.text
    assert "analyzer_vision_signals_ingested 1" in text
    assert "analyzer_security_signals_ingested 1" in text


def test_signals_vision_ingest_and_read(client) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    post_resp = client.post("/signals/vision", json={
        "timestamp": ts,
        "anomaly_score": 88.5,
        "defect_flag": True,
        "model_version": "test-v1",
        "inference_ms": 12.3,
        "source": "pytest-vision",
    })
    assert post_resp.status_code == 200
    assert post_resp.json()["ok"] is True

    get_resp = client.get("/signals")
    assert get_resp.status_code == 200
    vision = get_resp.json()["vision"]
    assert vision is not None
    assert vision["anomaly_score"] == 88.5
    assert vision["defect_flag"] is True
    assert vision["source"] == "pytest-vision"
    assert vision["fresh"] is True


def test_signals_security_ingest_and_read(client) -> None:
    ts = datetime.now(timezone.utc).isoformat()
    post_resp = client.post("/signals/security", json={
        "timestamp": ts,
        "packet_rate": 240.0,
        "burst_ratio": 0.92,
        "unauthorized_attempts": 3,
        "security_flag": True,
        "source": "pytest-security",
        "sample_window_seconds": 1.0,
    })
    assert post_resp.status_code == 200
    assert post_resp.json()["ok"] is True

    get_resp = client.get("/signals")
    assert get_resp.status_code == 200
    security = get_resp.json()["security"]
    assert security is not None
    assert security["packet_rate"] == 240.0
    assert security["security_flag"] is True
    assert security["source"] == "pytest-security"


def test_analyze_returns_full_response_shape(client) -> None:
    with patch("app.main.persist_analysis"):
        response = client.post("/analyze", json={
            "production_count": 20,
            "production_rate": 12.0,
            "reject_rate": 2.0,
            "conveyor_running": True,
            "bottle_at_filler": True,
            "bottle_at_capper": True,
            "bottle_at_quality": True,
            "in_flight_bottles": 3,
            "output_alarm_horn": False,
            "output_reject_gate": False,
            "network_packet_rate": 130.0,
            "network_burst_ratio": 0.2,
            "network_unauthorized_attempts": 0,
            "scan_time_ms": 100.0,
        })
    assert response.status_code == 200
    body = response.json()

    expected_keys = {
        "process_anomaly", "network_alert", "process_score", "network_score",
        "model_confidence", "process_components", "network_components",
        "risk_level", "recommended_action", "model_version",
        "vision_anomaly_score", "vision_defect_flag", "vision_inference_ms",
        "security_flag", "scan_time_ms", "process_source", "network_source",
        "reasons",
    }
    assert expected_keys.issubset(body.keys())
    assert isinstance(body["reasons"], list)
    assert body["risk_level"] in {"low", "medium", "high", "critical"}


def test_analyze_with_vision_signal_triggers_anomaly(client) -> None:
    with patch("app.main.persist_analysis"):
        response = client.post("/analyze", json={
            "production_count": 20,
            "production_rate": 12.0,
            "reject_rate": 2.0,
            "conveyor_running": True,
            "in_flight_bottles": 3,
            "network_packet_rate": 130.0,
            "network_burst_ratio": 0.2,
            "network_unauthorized_attempts": 0,
            "scan_time_ms": 100.0,
            "vision_anomaly_score": 95.0,
            "vision_defect_flag": True,
            "vision_model_version": "test-v1",
        })
    assert response.status_code == 200
    body = response.json()
    assert body["process_anomaly"] is True
    assert body["process_source"] == "payload-vision-signal"


def test_analyze_increments_metrics_counters(client) -> None:
    with patch("app.main.persist_analysis"):
        for _ in range(2):
            client.post("/analyze", json={
                "production_count": 10,
                "production_rate": 10.0,
                "reject_rate": 1.0,
                "network_packet_rate": 130.0,
                "network_burst_ratio": 0.2,
                "network_unauthorized_attempts": 0,
                "scan_time_ms": 50.0,
            })

    response = client.get("/metrics")
    text = response.text
    assert "analyzer_analyses_total 2" in text


def test_signals_endpoint_returns_null_when_no_signals(client) -> None:
    response = client.get("/signals")
    assert response.status_code == 200
    body = response.json()
    assert body["vision"] is None
    assert body["security"] is None


def test_events_endpoint_returns_list(client) -> None:
    fake_events = [
        {
            "id": 1,
            "created_at": "2025-01-01T00:00:00+00:00",
            "process_score": 42.0,
            "network_score": 10.0,
            "process_anomaly": True,
            "network_alert": False,
            "model_confidence": 88.0,
            "risk_level": "medium",
            "reasons": ["drift detected"],
        },
    ]
    with patch("app.main._fetch_events", return_value=fake_events):
        response = client.get("/events?limit=5")

    assert response.status_code == 200
    body = response.json()
    assert "count" in body
    assert "events" in body
    assert isinstance(body["events"], list)
    assert body["count"] == 1
    assert body["events"][0]["id"] == 1
    assert body["events"][0]["process_anomaly"] is True


def test_metrics_shows_vision_gauge_after_signal(client) -> None:
    client.post("/signals/vision", json={
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "anomaly_score": 73.5,
        "defect_flag": True,
        "model_version": "test-v1",
        "inference_ms": 8.0,
        "source": "pytest",
    })

    response = client.get("/metrics")
    text = response.text
    assert "analyzer_vision_anomaly_score 73.50" in text
    assert "analyzer_vision_signal_fresh 1" in text
