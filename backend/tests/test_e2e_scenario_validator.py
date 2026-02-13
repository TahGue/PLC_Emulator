from __future__ import annotations

from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import e2e_scenario_validator as validator


def test_scenario_definitions_cover_expected_flow() -> None:
    scenarios = validator._scenario_definitions()
    names = [scenario.name for scenario in scenarios]

    assert names == ["baseline", "defect", "network_attack", "combined_incident"]
    assert scenarios[0].expected_lockout is False
    assert scenarios[1].expected_process_anomaly is True
    assert scenarios[2].expected_network_alert is True
    assert scenarios[3].expected_process_anomaly is True and scenarios[3].expected_network_alert is True


def test_evaluate_result_marks_passing_case() -> None:
    scenario = validator.ScenarioDefinition(
        name="case",
        vision_payload={},
        security_payload={},
        telemetry_overrides={},
        expected_process_anomaly=True,
        expected_network_alert=False,
        expected_lockout=True,
    )

    response = {
        "process_anomaly": True,
        "network_alert": False,
    }

    result = validator._evaluate_result(
        scenario,
        response,
        observed_lockout=True,
        check_openplc=True,
    )

    assert result.passed is True
    assert result.notes == []


def test_evaluate_result_marks_failure_and_notes() -> None:
    scenario = validator.ScenarioDefinition(
        name="case",
        vision_payload={},
        security_payload={},
        telemetry_overrides={},
        expected_process_anomaly=False,
        expected_network_alert=True,
        expected_lockout=True,
    )

    response = {
        "process_anomaly": True,
        "network_alert": False,
    }

    result = validator._evaluate_result(
        scenario,
        response,
        observed_lockout=False,
        check_openplc=True,
    )

    assert result.passed is False
    assert len(result.notes) == 3
