from __future__ import annotations

import argparse
import os
import time
from dataclasses import dataclass
from typing import Any

import requests


@dataclass
class BridgeState:
    process_flag: bool
    security_flag: bool
    process_score: int
    security_score: int
    vision_fresh: bool
    security_fresh: bool
    vision_age_seconds: float | None
    security_age_seconds: float | None


def _clamp(value: float, minimum: float = 0, maximum: float = 100) -> float:
    return max(minimum, min(maximum, value))


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_address(address: int, address_base: int) -> int:
    if address < 0:
        return -1

    normalized = address - 1 if address_base == 1 else address
    if normalized < 0:
        raise ValueError(f"Address {address} is invalid for address base {address_base}")

    return normalized


def _derive_bridge_state(
    payload: dict[str, Any] | None,
    *,
    process_threshold: float,
    burst_threshold: float,
) -> BridgeState:
    if not isinstance(payload, dict):
        return BridgeState(False, False, 0, 0, False, False, None, None)

    vision = payload.get("vision") if isinstance(payload.get("vision"), dict) else None
    security = payload.get("security") if isinstance(payload.get("security"), dict) else None

    vision_fresh = bool(vision and vision.get("fresh"))
    security_fresh = bool(security and security.get("fresh"))

    process_score = 0
    process_flag = False
    vision_age_seconds = None

    if vision_fresh and vision:
        anomaly_score = _clamp(_safe_float(vision.get("anomaly_score"), 0.0))
        defect_flag = bool(vision.get("defect_flag"))
        process_flag = defect_flag or anomaly_score >= process_threshold
        process_score = int(round(anomaly_score))
        vision_age_seconds = _safe_float(vision.get("age_seconds"), 0.0)

    security_score = 0
    security_flag = False
    security_age_seconds = None

    if security_fresh and security:
        burst_ratio = _safe_float(security.get("burst_ratio"), 0.0)
        unauthorized_attempts = _safe_int(security.get("unauthorized_attempts"), 0)
        flagged = bool(security.get("security_flag"))

        security_flag = flagged or burst_ratio >= burst_threshold or unauthorized_attempts > 0

        burst_component = max((burst_ratio - burst_threshold) * 120.0, 0.0)
        unauthorized_component = min(60.0, unauthorized_attempts * 20.0)
        base_component = 100.0 if flagged else 0.0

        security_score = int(round(_clamp(max(base_component, burst_component + unauthorized_component))))
        security_age_seconds = _safe_float(security.get("age_seconds"), 0.0)

    return BridgeState(
        process_flag=process_flag,
        security_flag=security_flag,
        process_score=process_score,
        security_score=security_score,
        vision_fresh=vision_fresh,
        security_fresh=security_fresh,
        vision_age_seconds=vision_age_seconds,
        security_age_seconds=security_age_seconds,
    )


def _fetch_latest_signals(
    session: requests.Session,
    *,
    analyzer_base_url: str,
    timeout_seconds: float,
) -> dict[str, Any]:
    response = session.get(f"{analyzer_base_url.rstrip('/')}/signals", timeout=timeout_seconds)
    response.raise_for_status()

    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Unexpected /signals response payload")

    return payload


def _build_modbus_client(host: str, port: int, timeout_seconds: float):
    from pymodbus.client import ModbusTcpClient
    return ModbusTcpClient(host=host, port=port, timeout=timeout_seconds)


def _modbus_call_with_unit(method, *args, unit_id: int):
    try:
        return method(*args, slave=unit_id)
    except TypeError:
        try:
            return method(*args, unit=unit_id)
        except TypeError:
            return method(*args)


def _write_coil(client, address: int, value: bool, unit_id: int) -> None:
    response = _modbus_call_with_unit(client.write_coil, address, value, unit_id=unit_id)
    if hasattr(response, "isError") and response.isError():
        raise RuntimeError(f"Modbus coil write failed at {address}: {response}")


def _write_register(client, address: int, value: int, unit_id: int) -> None:
    response = _modbus_call_with_unit(client.write_register, address, value, unit_id=unit_id)
    if hasattr(response, "isError") and response.isError():
        raise RuntimeError(f"Modbus register write failed at {address}: {response}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bridge analyzer vision/security signals to OpenPLC over Modbus TCP")

    parser.add_argument(
        "--analyzer-base-url",
        default=os.getenv("ANALYZER_BASE_URL", "http://localhost:8001"),
        help="Analyzer API base URL (default: http://localhost:8001)",
    )
    parser.add_argument("--openplc-host", default=os.getenv("OPENPLC_HOST", "127.0.0.1"))
    parser.add_argument("--openplc-port", type=int, default=int(os.getenv("OPENPLC_PORT", "502")))
    parser.add_argument("--unit-id", type=int, default=int(os.getenv("OPENPLC_UNIT_ID", "1")))

    parser.add_argument("--poll-interval-seconds", type=float, default=1.0)
    parser.add_argument("--request-timeout-seconds", type=float, default=2.0)
    parser.add_argument("--modbus-timeout-seconds", type=float, default=1.5)

    parser.add_argument("--process-threshold", type=float, default=60.0)
    parser.add_argument("--burst-threshold", type=float, default=0.72)

    parser.add_argument("--process-flag-coil", type=int, default=8)
    parser.add_argument("--security-flag-coil", type=int, default=9)
    parser.add_argument("--process-score-register", type=int, default=100)
    parser.add_argument("--security-score-register", type=int, default=101)
    parser.add_argument("--heartbeat-coil", type=int, default=-1)
    parser.add_argument("--address-base", type=int, choices=[0, 1], default=0)

    parser.add_argument("--on-fetch-error", choices=["hold-last", "clear"], default="hold-last")
    parser.add_argument("--max-cycles", type=int, default=0, help="0 means run forever")
    parser.add_argument("--dry-run", action="store_true")

    return parser.parse_args()


def _format_state(state: BridgeState) -> str:
    return (
        f"process_flag={state.process_flag} process_score={state.process_score} "
        f"security_flag={state.security_flag} security_score={state.security_score} "
        f"vision_fresh={state.vision_fresh} security_fresh={state.security_fresh}"
    )


def main() -> None:
    args = parse_args()

    process_flag_coil = _normalize_address(args.process_flag_coil, args.address_base)
    security_flag_coil = _normalize_address(args.security_flag_coil, args.address_base)
    process_score_register = _normalize_address(args.process_score_register, args.address_base)
    security_score_register = _normalize_address(args.security_score_register, args.address_base)
    heartbeat_coil = _normalize_address(args.heartbeat_coil, args.address_base)

    last_state = BridgeState(False, False, 0, 0, False, False, None, None)
    heartbeat_value = False

    modbus_client = None
    if not args.dry_run:
        modbus_client = _build_modbus_client(
            host=args.openplc_host,
            port=args.openplc_port,
            timeout_seconds=args.modbus_timeout_seconds,
        )

    with requests.Session() as session:
        cycle = 0
        while True:
            cycle += 1

            try:
                signal_payload = _fetch_latest_signals(
                    session,
                    analyzer_base_url=args.analyzer_base_url,
                    timeout_seconds=args.request_timeout_seconds,
                )
                state = _derive_bridge_state(
                    signal_payload,
                    process_threshold=args.process_threshold,
                    burst_threshold=args.burst_threshold,
                )
                last_state = state
            except Exception as error:
                if args.on_fetch_error == "clear":
                    state = BridgeState(False, False, 0, 0, False, False, None, None)
                    last_state = state
                else:
                    state = last_state

                print(f"[cycle {cycle}] analyzer fetch failed: {error}")

            if args.dry_run:
                print(f"[cycle {cycle}] dry-run | {_format_state(state)}")
            else:
                assert modbus_client is not None
                if not getattr(modbus_client, "connected", False):
                    if not modbus_client.connect():
                        print(f"[cycle {cycle}] Modbus connect failed to {args.openplc_host}:{args.openplc_port}")
                        if args.max_cycles > 0 and cycle >= args.max_cycles:
                            break
                        time.sleep(max(args.poll_interval_seconds, 0.1))
                        continue

                try:
                    if process_flag_coil >= 0:
                        _write_coil(modbus_client, process_flag_coil, state.process_flag, args.unit_id)
                    if security_flag_coil >= 0:
                        _write_coil(modbus_client, security_flag_coil, state.security_flag, args.unit_id)

                    if process_score_register >= 0:
                        _write_register(modbus_client, process_score_register, state.process_score, args.unit_id)
                    if security_score_register >= 0:
                        _write_register(modbus_client, security_score_register, state.security_score, args.unit_id)

                    if heartbeat_coil >= 0:
                        heartbeat_value = not heartbeat_value
                        _write_coil(modbus_client, heartbeat_coil, heartbeat_value, args.unit_id)

                    print(f"[cycle {cycle}] wrote to OpenPLC | {_format_state(state)}")
                except Exception as error:
                    print(f"[cycle {cycle}] modbus write failed: {error}")
                    try:
                        modbus_client.close()
                    except Exception:
                        pass

            if args.max_cycles > 0 and cycle >= args.max_cycles:
                break

            time.sleep(max(args.poll_interval_seconds, 0.1))

    if modbus_client is not None:
        try:
            modbus_client.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
