from __future__ import annotations

from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import network_attack_injector as injector


def test_build_payload_modes_return_bytes() -> None:
    illegal_payload = injector._build_payload("modbus-illegal-function", transaction_id=7, payload_size=32)
    short_payload = injector._build_payload("modbus-short-frame", transaction_id=7, payload_size=32)
    bad_length_payload = injector._build_payload("modbus-bad-length", transaction_id=7, payload_size=32)
    random_payload = injector._build_payload("random-bytes", transaction_id=7, payload_size=24)

    assert isinstance(illegal_payload, bytes)
    assert isinstance(short_payload, bytes)
    assert isinstance(bad_length_payload, bytes)
    assert isinstance(random_payload, bytes)

    assert len(short_payload) == 3
    assert len(random_payload) == 24


def test_extract_security_status_parses_payload() -> None:
    payload = {
        "security": {
            "fresh": True,
            "security_flag": True,
            "age_seconds": 0.55,
        }
    }

    fresh, security_flag, age_seconds = injector._extract_security_status(payload)

    assert fresh is True
    assert security_flag is True
    assert age_seconds is not None and age_seconds > 0


def test_extract_security_status_handles_missing_payload() -> None:
    fresh, security_flag, age_seconds = injector._extract_security_status({})

    assert fresh is False
    assert security_flag is False
    assert age_seconds is None
