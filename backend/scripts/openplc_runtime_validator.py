from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass
class ValidationCase:
    name: str
    process_flag: bool
    security_flag: bool
    expected_lockout: bool


@dataclass
class ValidationResult:
    case_name: str
    process_flag: bool
    security_flag: bool
    expected_lockout: bool
    observed_lockout: bool
    passed: bool


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


def _build_modbus_client(host: str, port: int, timeout_seconds: float):
    from pymodbus.client import ModbusTcpClient

    return ModbusTcpClient(host=host, port=port, timeout=timeout_seconds)


def _write_bool(client, *, target_type: str, address: int, value: bool, unit_id: int) -> None:
    if target_type == "coil":
        response = _modbus_call_with_unit(client.write_coil, address, value, unit_id=unit_id)
    else:
        response = _modbus_call_with_unit(client.write_register, address, int(value), unit_id=unit_id)

    if hasattr(response, "isError") and response.isError():
        raise RuntimeError(f"Write failed for {target_type} at address {address}: {response}")


def _read_bool(client, *, source_type: str, address: int, unit_id: int) -> bool:
    if source_type == "coil":
        response = _modbus_call_with_unit(client.read_coils, address, 1, unit_id=unit_id)
        if hasattr(response, "isError") and response.isError():
            raise RuntimeError(f"Read coils failed at address {address}: {response}")

        bits = getattr(response, "bits", None)
        if not bits:
            raise RuntimeError(f"No coil bits returned for address {address}")

        return bool(bits[0])

    response = _modbus_call_with_unit(client.read_holding_registers, address, 1, unit_id=unit_id)
    if hasattr(response, "isError") and response.isError():
        raise RuntimeError(f"Read register failed at address {address}: {response}")

    registers = getattr(response, "registers", None)
    if not registers:
        raise RuntimeError(f"No register values returned for address {address}")

    return bool(registers[0])


def _default_cases() -> list[ValidationCase]:
    return [
        ValidationCase("baseline", False, False, False),
        ValidationCase("process_only", True, False, True),
        ValidationCase("security_only", False, True, True),
        ValidationCase("combined", True, True, True),
    ]


def _run_case(
    client,
    *,
    case: ValidationCase,
    process_target_type: str,
    process_target_address: int,
    security_target_type: str,
    security_target_address: int,
    lockout_source_type: str,
    lockout_source_address: int,
    unit_id: int,
    settle_seconds: float,
) -> ValidationResult:
    _write_bool(
        client,
        target_type=process_target_type,
        address=process_target_address,
        value=case.process_flag,
        unit_id=unit_id,
    )
    _write_bool(
        client,
        target_type=security_target_type,
        address=security_target_address,
        value=case.security_flag,
        unit_id=unit_id,
    )

    time.sleep(max(settle_seconds, 0.0))

    observed_lockout = _read_bool(
        client,
        source_type=lockout_source_type,
        address=lockout_source_address,
        unit_id=unit_id,
    )

    passed = observed_lockout == case.expected_lockout
    return ValidationResult(
        case_name=case.name,
        process_flag=case.process_flag,
        security_flag=case.security_flag,
        expected_lockout=case.expected_lockout,
        observed_lockout=observed_lockout,
        passed=passed,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate OpenPLC lockout behavior for process/security flags")

    parser.add_argument("--openplc-host", default="127.0.0.1")
    parser.add_argument("--openplc-port", type=int, default=502)
    parser.add_argument("--unit-id", type=int, default=1)
    parser.add_argument("--timeout-seconds", type=float, default=1.5)
    parser.add_argument("--settle-seconds", type=float, default=0.35)
    parser.add_argument("--address-base", type=int, choices=[0, 1], default=0)

    parser.add_argument("--process-flag-type", choices=["coil", "register"], default="coil")
    parser.add_argument("--process-flag-address", type=int, default=8)
    parser.add_argument("--security-flag-type", choices=["coil", "register"], default="coil")
    parser.add_argument("--security-flag-address", type=int, default=9)

    parser.add_argument("--lockout-type", choices=["coil", "register"], default="coil")
    parser.add_argument("--lockout-address", type=int, default=8)

    parser.add_argument("--report-json", default="", help="Optional path to save validation results as JSON")

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    process_flag_address = _normalize_address(args.process_flag_address, args.address_base)
    security_flag_address = _normalize_address(args.security_flag_address, args.address_base)
    lockout_address = _normalize_address(args.lockout_address, args.address_base)

    client = _build_modbus_client(args.openplc_host, args.openplc_port, args.timeout_seconds)

    if not client.connect():
        raise RuntimeError(f"Could not connect to OpenPLC at {args.openplc_host}:{args.openplc_port}")

    results: list[ValidationResult] = []
    try:
        for case in _default_cases():
            result = _run_case(
                client,
                case=case,
                process_target_type=args.process_flag_type,
                process_target_address=process_flag_address,
                security_target_type=args.security_flag_type,
                security_target_address=security_flag_address,
                lockout_source_type=args.lockout_type,
                lockout_source_address=lockout_address,
                unit_id=args.unit_id,
                settle_seconds=args.settle_seconds,
            )
            results.append(result)

            status = "PASS" if result.passed else "FAIL"
            print(
                f"[{status}] {result.case_name}: process={result.process_flag} "
                f"security={result.security_flag} expected_lockout={result.expected_lockout} "
                f"observed_lockout={result.observed_lockout}"
            )

        # Restore baseline flags after validation.
        _write_bool(
            client,
            target_type=args.process_flag_type,
            address=process_flag_address,
            value=False,
            unit_id=args.unit_id,
        )
        _write_bool(
            client,
            target_type=args.security_flag_type,
            address=security_flag_address,
            value=False,
            unit_id=args.unit_id,
        )
    finally:
        client.close()

    if args.report_json:
        report_path = Path(args.report_json)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps([asdict(result) for result in results], indent=2),
            encoding="utf-8",
        )
        print(f"Saved report to {report_path.resolve()}")

    failed = [result for result in results if not result.passed]
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
