from __future__ import annotations

from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import openplc_modbus_bridge as bridge


def test_derive_bridge_state_with_fresh_vision_signal() -> None:
    payload = {
        "vision": {
            "fresh": True,
            "anomaly_score": 88,
            "defect_flag": False,
            "age_seconds": 0.4,
        },
        "security": None,
    }

    state = bridge._derive_bridge_state(payload, process_threshold=60, burst_threshold=0.72)

    assert state.process_flag is True
    assert state.process_score == 88
    assert state.vision_fresh is True
    assert state.security_flag is False


def test_derive_bridge_state_with_fresh_security_signal() -> None:
    payload = {
        "vision": None,
        "security": {
            "fresh": True,
            "security_flag": False,
            "burst_ratio": 0.91,
            "unauthorized_attempts": 2,
            "age_seconds": 0.8,
        },
    }

    state = bridge._derive_bridge_state(payload, process_threshold=60, burst_threshold=0.72)

    assert state.security_flag is True
    assert state.security_score > 0
    assert state.security_fresh is True


def test_derive_bridge_state_ignores_stale_signals() -> None:
    payload = {
        "vision": {
            "fresh": False,
            "anomaly_score": 99,
            "defect_flag": True,
            "age_seconds": 30,
        },
        "security": {
            "fresh": False,
            "security_flag": True,
            "burst_ratio": 0.99,
            "unauthorized_attempts": 4,
            "age_seconds": 30,
        },
    }

    state = bridge._derive_bridge_state(payload, process_threshold=60, burst_threshold=0.72)

    assert state.process_flag is False
    assert state.security_flag is False
    assert state.process_score == 0
    assert state.security_score == 0


def test_normalize_address_supports_zero_and_one_based() -> None:
    assert bridge._normalize_address(8, 0) == 8
    assert bridge._normalize_address(8, 1) == 7
    assert bridge._normalize_address(-1, 0) == -1
