#!/usr/bin/env python3
"""
Docker Compose full-stack smoke test.

Prerequisites:
    docker compose up --build -d

Usage:
    python scripts/smoke_test.py [--base-url http://localhost:8001]

Verifies:
    1. /health returns ok + db connected
    2. /metrics returns Prometheus text
    3. /signals (empty state)
    4. POST /signals/vision ingests correctly
    5. POST /signals/security ingests correctly
    6. /signals reflects ingested data
    7. POST /analyze returns full response
    8. /events returns persisted event
    9. /events/stream returns SSE data
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone

import requests


BASE_URL = "http://localhost:8001"
PASS = 0
FAIL = 0


def log_pass(name: str, detail: str = "") -> None:
    global PASS
    PASS += 1
    suffix = f" — {detail}" if detail else ""
    print(f"  PASS  {name}{suffix}")


def log_fail(name: str, detail: str = "") -> None:
    global FAIL
    FAIL += 1
    suffix = f" — {detail}" if detail else ""
    print(f"  FAIL  {name}{suffix}")


def check(name: str, condition: bool, detail: str = "") -> bool:
    if condition:
        log_pass(name, detail)
    else:
        log_fail(name, detail)
    return condition


def wait_for_health(base: str, timeout: int = 60) -> bool:
    print(f"\nWaiting for {base}/health (up to {timeout}s)...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = requests.get(f"{base}/health", timeout=3)
            if r.status_code == 200 and r.json().get("ok"):
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def run(base: str) -> None:
    print(f"\n{'=' * 60}")
    print(f"  Smoke Test — {base}")
    print(f"{'=' * 60}")

    # 1) Health
    if not wait_for_health(base):
        log_fail("/health", "Backend did not become healthy in time")
        return

    r = requests.get(f"{base}/health")
    body = r.json()
    check("/health status", r.status_code == 200)
    check("/health ok", body.get("ok") is True)
    check("/health db", body.get("db") is True, f"db={body.get('db')}")

    # 2) Metrics
    r = requests.get(f"{base}/metrics")
    check("/metrics status", r.status_code == 200)
    check("/metrics has counters", "analyzer_analyses_total" in r.text)

    # 3) Signals (empty)
    r = requests.get(f"{base}/signals")
    body = r.json()
    check("/signals empty vision", body.get("vision") is None)
    check("/signals empty security", body.get("security") is None)

    # 4) Ingest vision signal
    ts = datetime.now(timezone.utc).isoformat()
    r = requests.post(f"{base}/signals/vision", json={
        "timestamp": ts,
        "anomaly_score": 72.5,
        "defect_flag": True,
        "model_version": "smoke-test-v1",
        "inference_ms": 9.1,
        "source": "smoke-test",
    })
    check("POST /signals/vision", r.status_code == 200 and r.json().get("ok"))

    # 5) Ingest security signal
    r = requests.post(f"{base}/signals/security", json={
        "timestamp": ts,
        "packet_rate": 210.0,
        "burst_ratio": 0.85,
        "unauthorized_attempts": 2,
        "security_flag": True,
        "source": "smoke-test",
        "sample_window_seconds": 1.0,
    })
    check("POST /signals/security", r.status_code == 200 and r.json().get("ok"))

    # 6) Signals reflect data
    r = requests.get(f"{base}/signals")
    body = r.json()
    check("/signals vision populated", body.get("vision") is not None)
    check("/signals vision score", body["vision"]["anomaly_score"] == 72.5 if body.get("vision") else False)
    check("/signals security populated", body.get("security") is not None)
    check("/signals security flag", body["security"]["security_flag"] is True if body.get("security") else False)

    # 7) Analyze
    r = requests.post(f"{base}/analyze", json={
        "production_count": 50,
        "production_rate": 14.0,
        "reject_rate": 3.0,
        "conveyor_running": True,
        "bottle_at_filler": True,
        "bottle_at_capper": False,
        "bottle_at_quality": True,
        "in_flight_bottles": 4,
        "output_alarm_horn": False,
        "output_reject_gate": False,
        "network_packet_rate": 130.0,
        "network_burst_ratio": 0.2,
        "network_unauthorized_attempts": 0,
        "scan_time_ms": 95.0,
    })
    check("POST /analyze status", r.status_code == 200)
    abody = r.json()
    expected_keys = {"process_anomaly", "network_alert", "process_score", "network_score",
                     "risk_level", "recommended_action", "model_version", "reasons"}
    check("POST /analyze keys", expected_keys.issubset(abody.keys()), f"keys={list(abody.keys())[:8]}...")
    check("POST /analyze risk_level valid", abody.get("risk_level") in {"low", "medium", "high", "critical"})

    # 8) Events (should have at least 1 persisted)
    r = requests.get(f"{base}/events?limit=5")
    check("/events status", r.status_code == 200)
    ebody = r.json()
    check("/events has events", ebody.get("count", 0) >= 1, f"count={ebody.get('count')}")

    # 9) Metrics after activity
    r = requests.get(f"{base}/metrics")
    text = r.text
    check("/metrics analyses incremented", "analyzer_analyses_total 1" in text or "analyzer_analyses_total 2" in text)
    check("/metrics vision ingested", "analyzer_vision_signals_ingested 1" in text)
    check("/metrics security ingested", "analyzer_security_signals_ingested 1" in text)

    # 10) SSE stream (quick check — connect, read first chunk, disconnect)
    try:
        r = requests.get(f"{base}/events/stream?since_id=0", stream=True, timeout=5)
        check("/events/stream status", r.status_code == 200)
        first_chunk = next(r.iter_lines(decode_unicode=True), "")
        check("/events/stream has data", len(first_chunk) > 0, f"chunk={first_chunk[:60]}")
        r.close()
    except Exception as e:
        log_fail("/events/stream", str(e))

    # Summary
    print(f"\n{'=' * 60}")
    print(f"  Results: {PASS} passed, {FAIL} failed")
    print(f"{'=' * 60}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Docker Compose full-stack smoke test")
    parser.add_argument("--base-url", default=BASE_URL, help="Analyzer API base URL")
    args = parser.parse_args()

    run(args.base_url)

    if FAIL > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
