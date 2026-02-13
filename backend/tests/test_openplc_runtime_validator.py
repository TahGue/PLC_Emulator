from __future__ import annotations

from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import openplc_runtime_validator as validator


def test_default_cases_cover_expected_scenarios() -> None:
    cases = validator._default_cases()
    names = [case.name for case in cases]

    assert names == ["baseline", "process_only", "security_only", "combined"]
    assert cases[0].expected_lockout is False
    assert cases[1].expected_lockout is True
    assert cases[2].expected_lockout is True
    assert cases[3].expected_lockout is True


def test_normalize_address_respects_address_base() -> None:
    assert validator._normalize_address(8, 0) == 8
    assert validator._normalize_address(8, 1) == 7
