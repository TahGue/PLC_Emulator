from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.main import (
    SecuritySignalPayload,
    TelemetryPayload,
    VisionSignalPayload,
    analyze_payload,
    ingest_security_signal,
    ingest_vision_signal,
    reset_runtime_state_for_tests,
)


def _base_payload() -> TelemetryPayload:
    return TelemetryPayload(
        production_count=20,
        production_rate=12,
        reject_rate=2,
        conveyor_running=True,
        bottle_at_filler=True,
        bottle_at_capper=True,
        bottle_at_quality=True,
        in_flight_bottles=3,
        output_alarm_horn=False,
        output_reject_gate=False,
        network_packet_rate=130,
        network_burst_ratio=0.2,
        network_unauthorized_attempts=0,
        scan_time_ms=100,
    )


def test_payload_vision_signal_triggers_process_anomaly() -> None:
    reset_runtime_state_for_tests()

    payload = _base_payload()
    payload.vision_anomaly_score = 92
    payload.vision_defect_flag = True
    payload.vision_model_version = "mvtec-feature-ocsvm-v1"

    result = analyze_payload(payload)

    assert result.process_anomaly is True
    assert result.process_score >= 90
    assert result.process_source == "payload-vision-signal"
    assert result.vision_defect_flag is True


def test_external_security_signal_triggers_network_alert() -> None:
    reset_runtime_state_for_tests()

    ingest_security_signal(
        SecuritySignalPayload(
            timestamp=datetime.now(timezone.utc).isoformat(),
            packet_rate=260,
            burst_ratio=0.95,
            unauthorized_attempts=2,
            security_flag=True,
            source="pytest-security-monitor",
            sample_window_seconds=1,
        )
    )

    result = analyze_payload(_base_payload())

    assert result.network_alert is True
    assert result.security_flag is True
    assert result.network_source == "external-security-signal"


def test_stale_vision_signal_is_ignored() -> None:
    reset_runtime_state_for_tests()

    stale_timestamp = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    ingest_vision_signal(
        VisionSignalPayload(
            timestamp=stale_timestamp,
            anomaly_score=100,
            defect_flag=True,
            model_version="mvtec-feature-ocsvm-v1",
            inference_ms=12,
            source="pytest-vision",
        )
    )

    result = analyze_payload(_base_payload())

    assert result.process_source != "external-vision-signal"
    assert result.process_source in {"fallback-telemetry-drift", "no-vision-signal"}


def test_fallback_lane_available_without_external_signals() -> None:
    reset_runtime_state_for_tests()

    result = analyze_payload(_base_payload())

    assert result.process_source in {"fallback-telemetry-drift", "no-vision-signal"}
    assert result.process_score >= 0
