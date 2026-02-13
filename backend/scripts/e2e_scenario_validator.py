from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


@dataclass
class ScenarioDefinition:
    name: str
    vision_payload: dict[str, Any]
    security_payload: dict[str, Any]
    telemetry_overrides: dict[str, Any]
    expected_process_anomaly: bool
    expected_network_alert: bool
    expected_lockout: bool


@dataclass
class ScenarioResult:
    scenario_name: str
    expected_process_anomaly: bool
    observed_process_anomaly: bool
    expected_network_alert: bool
    observed_network_alert: bool
    expected_lockout: bool
    observed_lockout: bool | None
    passed: bool
    notes: list[str]


def _normalize_address(address: int, address_base: int) -> int:
    if address < 0:
        raise ValueError("Address cannot be negative")

    normalized = address - 1 if address_base == 1 else address
    if normalized < 0:
        raise ValueError(f"Address {address} is invalid for base {address_base}")

    return normalized


def _modbus_call_with_unit(method, *args, unit_id: int):
    try:
        return method(*args, slave=unit_id)
    except TypeError:
        try:
            return method(*args, unit=unit_id)
        except TypeError:
            return method(*args)


def _read_lockout_coil(*, host: str, port: int, unit_id: int, address: int, timeout_seconds: float) -> bool:
    from pymodbus.client import ModbusTcpClient

    client = ModbusTcpClient(host=host, port=port, timeout=timeout_seconds)
    if not client.connect():
        raise RuntimeError(f"Could not connect to OpenPLC Modbus endpoint {host}:{port}")

    try:
        response = _modbus_call_with_unit(client.read_coils, address, 1, unit_id=unit_id)
        if hasattr(response, "isError") and response.isError():
            raise RuntimeError(f"Failed reading lockout coil at address {address}: {response}")

        bits = getattr(response, "bits", None)
        if not bits:
            raise RuntimeError(f"No lockout coil bits returned for address {address}")

        return bool(bits[0])
    finally:
        client.close()


def _base_telemetry_payload() -> dict[str, Any]:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "production_count": 100,
        "production_rate": 12,
        "reject_rate": 1,
        "conveyor_running": True,
        "bottle_at_filler": True,
        "bottle_at_capper": True,
        "bottle_at_quality": True,
        "in_flight_bottles": 3,
        "output_alarm_horn": False,
        "output_reject_gate": False,
        "network_packet_rate": 130,
        "network_burst_ratio": 0.2,
        "network_unauthorized_attempts": 0,
        "scan_time_ms": 100,
    }


def _scenario_definitions() -> list[ScenarioDefinition]:
    return [
        ScenarioDefinition(
            name="baseline",
            vision_payload={
                "anomaly_score": 5,
                "defect_flag": False,
                "source": "e2e-validator",
            },
            security_payload={
                "packet_rate": 130,
                "burst_ratio": 0.2,
                "unauthorized_attempts": 0,
                "security_flag": False,
                "source": "e2e-validator",
            },
            telemetry_overrides={},
            expected_process_anomaly=False,
            expected_network_alert=False,
            expected_lockout=False,
        ),
        ScenarioDefinition(
            name="defect",
            vision_payload={
                "anomaly_score": 95,
                "defect_flag": True,
                "source": "e2e-validator",
            },
            security_payload={
                "packet_rate": 132,
                "burst_ratio": 0.2,
                "unauthorized_attempts": 0,
                "security_flag": False,
                "source": "e2e-validator",
            },
            telemetry_overrides={},
            expected_process_anomaly=True,
            expected_network_alert=False,
            expected_lockout=True,
        ),
        ScenarioDefinition(
            name="network_attack",
            vision_payload={
                "anomaly_score": 6,
                "defect_flag": False,
                "source": "e2e-validator",
            },
            security_payload={
                "packet_rate": 255,
                "burst_ratio": 0.95,
                "unauthorized_attempts": 2,
                "security_flag": True,
                "source": "e2e-validator",
            },
            telemetry_overrides={},
            expected_process_anomaly=False,
            expected_network_alert=True,
            expected_lockout=True,
        ),
        ScenarioDefinition(
            name="combined_incident",
            vision_payload={
                "anomaly_score": 97,
                "defect_flag": True,
                "source": "e2e-validator",
            },
            security_payload={
                "packet_rate": 260,
                "burst_ratio": 0.97,
                "unauthorized_attempts": 3,
                "security_flag": True,
                "source": "e2e-validator",
            },
            telemetry_overrides={"reject_rate": 14, "in_flight_bottles": 9},
            expected_process_anomaly=True,
            expected_network_alert=True,
            expected_lockout=True,
        ),
    ]


def _post_signal(
    session: requests.Session,
    *,
    base_url: str,
    endpoint: str,
    payload: dict[str, Any],
    timeout_seconds: float,
) -> None:
    body = dict(payload)
    body["timestamp"] = datetime.now(timezone.utc).isoformat()

    response = session.post(
        f"{base_url.rstrip('/')}{endpoint}",
        json=body,
        timeout=timeout_seconds,
    )
    response.raise_for_status()


def _run_analyze(
    session: requests.Session,
    *,
    base_url: str,
    payload: dict[str, Any],
    timeout_seconds: float,
) -> dict[str, Any]:
    response = session.post(
        f"{base_url.rstrip('/')}/analyze",
        json=payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()

    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Unexpected /analyze response payload")

    return data


def _evaluate_result(
    scenario: ScenarioDefinition,
    analyze_response: dict[str, Any],
    observed_lockout: bool | None,
    check_openplc: bool,
) -> ScenarioResult:
    observed_process = bool(analyze_response.get("process_anomaly"))
    observed_network = bool(analyze_response.get("network_alert"))

    notes: list[str] = []
    passed = True

    if observed_process != scenario.expected_process_anomaly:
        passed = False
        notes.append(
            f"process_anomaly expected={scenario.expected_process_anomaly} observed={observed_process}"
        )

    if observed_network != scenario.expected_network_alert:
        passed = False
        notes.append(
            f"network_alert expected={scenario.expected_network_alert} observed={observed_network}"
        )

    if check_openplc:
        assert observed_lockout is not None
        if observed_lockout != scenario.expected_lockout:
            passed = False
            notes.append(
                f"lockout expected={scenario.expected_lockout} observed={observed_lockout}"
            )

    return ScenarioResult(
        scenario_name=scenario.name,
        expected_process_anomaly=scenario.expected_process_anomaly,
        observed_process_anomaly=observed_process,
        expected_network_alert=scenario.expected_network_alert,
        observed_network_alert=observed_network,
        expected_lockout=scenario.expected_lockout,
        observed_lockout=observed_lockout,
        passed=passed,
        notes=notes,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run end-to-end analyzer scenario validation")

    parser.add_argument("--api-base-url", default="http://localhost:8001")
    parser.add_argument("--request-timeout-seconds", type=float, default=3.0)
    parser.add_argument("--scenario-settle-seconds", type=float, default=0.35)

    parser.add_argument("--check-openplc", action="store_true")
    parser.add_argument("--openplc-host", default="127.0.0.1")
    parser.add_argument("--openplc-port", type=int, default=502)
    parser.add_argument("--openplc-unit-id", type=int, default=1)
    parser.add_argument("--openplc-lockout-coil-address", type=int, default=8)
    parser.add_argument("--address-base", type=int, choices=[0, 1], default=0)
    parser.add_argument("--openplc-timeout-seconds", type=float, default=1.5)

    parser.add_argument("--report-json", default="", help="Optional path to save scenario report")

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    lockout_address = _normalize_address(args.openplc_lockout_coil_address, args.address_base)

    results: list[ScenarioResult] = []

    with requests.Session() as session:
        for scenario in _scenario_definitions():
            _post_signal(
                session,
                base_url=args.api_base_url,
                endpoint="/signals/vision",
                payload=scenario.vision_payload,
                timeout_seconds=args.request_timeout_seconds,
            )
            _post_signal(
                session,
                base_url=args.api_base_url,
                endpoint="/signals/security",
                payload=scenario.security_payload,
                timeout_seconds=args.request_timeout_seconds,
            )

            time.sleep(max(args.scenario_settle_seconds, 0.0))

            payload = _base_telemetry_payload()
            payload.update(scenario.telemetry_overrides)
            payload["timestamp"] = datetime.now(timezone.utc).isoformat()

            analyze_response = _run_analyze(
                session,
                base_url=args.api_base_url,
                payload=payload,
                timeout_seconds=args.request_timeout_seconds,
            )

            observed_lockout = None
            if args.check_openplc:
                observed_lockout = _read_lockout_coil(
                    host=args.openplc_host,
                    port=args.openplc_port,
                    unit_id=args.openplc_unit_id,
                    address=lockout_address,
                    timeout_seconds=args.openplc_timeout_seconds,
                )

            result = _evaluate_result(
                scenario,
                analyze_response,
                observed_lockout,
                args.check_openplc,
            )
            results.append(result)

            status = "PASS" if result.passed else "FAIL"
            print(
                f"[{status}] {result.scenario_name}: process={result.observed_process_anomaly} "
                f"network={result.observed_network_alert} lockout={result.observed_lockout}"
            )
            if result.notes:
                print(f"  Notes: {' | '.join(result.notes)}")

    if args.report_json:
        report_path = Path(args.report_json)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps([asdict(result) for result in results], indent=2),
            encoding="utf-8",
        )
        print(f"Saved report: {report_path.resolve()}")

    failures = [result for result in results if not result.passed]
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
