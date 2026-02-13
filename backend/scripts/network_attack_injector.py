from __future__ import annotations

import argparse
import json
import os
import socket
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests


@dataclass
class AttackStats:
    attempted_connections: int
    successful_connections: int
    failed_connections: int
    bytes_sent: int
    sample_errors: list[str]


def _build_payload(mode: str, transaction_id: int, payload_size: int) -> bytes:
    if mode == "random-bytes":
        return os.urandom(max(payload_size, 1))

    if mode == "modbus-short-frame":
        return b"\x00\x01\x00"

    if mode == "modbus-bad-length":
        # MBAP length field intentionally mismatches payload size.
        header = transaction_id.to_bytes(2, "big") + b"\x00\x00" + (250).to_bytes(2, "big")
        return header + b"\x01\x03\x00"

    if mode == "modbus-illegal-function":
        unit_id = 1
        illegal_function = 0x7F
        data = b"\x00\x10\x00\x01"
        pdu = bytes([illegal_function]) + data
        mbap_length = 1 + len(pdu)
        header = (
            transaction_id.to_bytes(2, "big")
            + b"\x00\x00"
            + mbap_length.to_bytes(2, "big")
            + bytes([unit_id])
        )
        return header + pdu

    raise ValueError(f"Unsupported payload mode: {mode}")


def _send_attack_payload(host: str, port: int, payload: bytes, timeout_seconds: float) -> int:
    with socket.create_connection((host, port), timeout=timeout_seconds) as sock:
        sock.sendall(payload)
    return len(payload)


def _extract_security_status(payload: dict[str, Any]) -> tuple[bool, bool, float | None]:
    security = payload.get("security") if isinstance(payload, dict) else None
    if not isinstance(security, dict):
        return False, False, None

    fresh = bool(security.get("fresh"))
    security_flag = bool(security.get("security_flag"))

    age_seconds = None
    try:
        if security.get("age_seconds") is not None:
            age_seconds = float(security.get("age_seconds"))
    except (TypeError, ValueError):
        age_seconds = None

    return fresh, security_flag, age_seconds


def _wait_for_security_flag(
    session: requests.Session,
    *,
    analyzer_base_url: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
) -> tuple[bool, dict[str, Any] | None]:
    deadline = time.monotonic() + max(timeout_seconds, 0.0)
    last_payload: dict[str, Any] | None = None

    while time.monotonic() <= deadline:
        try:
            response = session.get(
                f"{analyzer_base_url.rstrip('/')}/signals",
                timeout=2.0,
            )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict):
                last_payload = payload
                fresh, security_flag, _ = _extract_security_status(payload)
                if fresh and security_flag:
                    return True, payload
        except Exception:
            pass

        time.sleep(max(poll_interval_seconds, 0.05))

    return False, last_payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inject manual network attack traffic for security-lane validation")

    parser.add_argument("--target-host", default="127.0.0.1")
    parser.add_argument("--target-port", type=int, default=502)
    parser.add_argument("--duration-seconds", type=float, default=8.0)
    parser.add_argument("--burst-rate", type=float, default=120.0, help="Packets per second across all workers")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--payload-mode",
        choices=["modbus-illegal-function", "modbus-bad-length", "modbus-short-frame", "random-bytes"],
        default="modbus-illegal-function",
    )
    parser.add_argument("--payload-size", type=int, default=32, help="Used when --payload-mode random-bytes")
    parser.add_argument("--connect-timeout-seconds", type=float, default=0.4)

    parser.add_argument("--check-analyzer", action="store_true")
    parser.add_argument("--analyzer-base-url", default="http://localhost:8001")
    parser.add_argument("--wait-for-flag-seconds", type=float, default=8.0)
    parser.add_argument("--poll-interval-seconds", type=float, default=0.5)
    parser.add_argument("--require-security-flag", action="store_true")

    parser.add_argument("--report-json", default="", help="Optional output path for attack summary")

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    workers = max(args.workers, 1)
    burst_rate = max(args.burst_rate, 1.0)
    per_worker_interval = workers / burst_rate
    duration_seconds = max(args.duration_seconds, 0.1)

    started_at = datetime.now(timezone.utc)
    end_time = time.monotonic() + duration_seconds

    lock = threading.Lock()
    stats = {
        "attempted_connections": 0,
        "successful_connections": 0,
        "failed_connections": 0,
        "bytes_sent": 0,
        "sample_errors": [],
    }

    def worker_loop(worker_id: int) -> None:
        transaction_id = worker_id * 10000
        while time.monotonic() < end_time:
            transaction_id += 1
            payload = _build_payload(args.payload_mode, transaction_id, args.payload_size)

            with lock:
                stats["attempted_connections"] += 1

            try:
                bytes_sent = _send_attack_payload(
                    args.target_host,
                    args.target_port,
                    payload,
                    args.connect_timeout_seconds,
                )
                with lock:
                    stats["successful_connections"] += 1
                    stats["bytes_sent"] += bytes_sent
            except Exception as error:
                with lock:
                    stats["failed_connections"] += 1
                    if len(stats["sample_errors"]) < 8:
                        stats["sample_errors"].append(str(error))

            time.sleep(max(per_worker_interval, 0.0))

    threads = [threading.Thread(target=worker_loop, args=(index,), daemon=True) for index in range(workers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    attack_stats = AttackStats(
        attempted_connections=int(stats["attempted_connections"]),
        successful_connections=int(stats["successful_connections"]),
        failed_connections=int(stats["failed_connections"]),
        bytes_sent=int(stats["bytes_sent"]),
        sample_errors=list(stats["sample_errors"]),
    )

    print(
        f"Attack completed: attempted={attack_stats.attempted_connections} "
        f"success={attack_stats.successful_connections} failed={attack_stats.failed_connections} "
        f"bytes={attack_stats.bytes_sent}"
    )

    analyzer_flagged = None
    analyzer_payload = None

    if args.check_analyzer:
        with requests.Session() as session:
            analyzer_flagged, analyzer_payload = _wait_for_security_flag(
                session,
                analyzer_base_url=args.analyzer_base_url,
                timeout_seconds=args.wait_for_flag_seconds,
                poll_interval_seconds=args.poll_interval_seconds,
            )

        if analyzer_flagged:
            print("Analyzer security lane flagged attack traffic.")
        else:
            print("Analyzer security lane did NOT flag attack traffic within timeout window.")

    report = {
        "started_at": started_at.isoformat(),
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "target_host": args.target_host,
        "target_port": args.target_port,
        "payload_mode": args.payload_mode,
        "duration_seconds": duration_seconds,
        "burst_rate": burst_rate,
        "workers": workers,
        "stats": asdict(attack_stats),
        "analyzer_check_enabled": bool(args.check_analyzer),
        "analyzer_security_flag_observed": analyzer_flagged,
        "analyzer_signals_snapshot": analyzer_payload,
    }

    if args.report_json:
        output_path = Path(args.report_json)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"Saved report: {output_path.resolve()}")

    if args.require_security_flag and not analyzer_flagged:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
