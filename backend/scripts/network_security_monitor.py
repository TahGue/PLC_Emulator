from __future__ import annotations

import argparse
import random
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable

import requests
from scapy.all import IP, TCP, sniff


DEFAULT_PROTOCOL_PORTS = (502, 4840, 1883)


@dataclass
class WindowStats:
    packet_rate: float
    burst_ratio: float
    unauthorized_attempts: int
    security_flag: bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Monitor control-lane traffic and push security signals")
    parser.add_argument("--api-base-url", default="http://localhost:8001")
    parser.add_argument("--interface", default="", help="Network interface name (optional)")
    parser.add_argument("--window-seconds", type=float, default=1.0)
    parser.add_argument("--history-windows", type=int, default=30)
    parser.add_argument("--expected-rate", type=float, default=130.0)
    parser.add_argument("--burst-threshold", type=float, default=0.72)
    parser.add_argument("--unauthorized-threshold", type=int, default=0)
    parser.add_argument("--max-samples", type=int, default=0, help="Limit windows processed (0 = infinite)")
    parser.add_argument("--loop", action="store_true", help="Continue running indefinitely")
    parser.add_argument("--timeout-seconds", type=float, default=3.0)
    parser.add_argument(
        "--allowed-source-ips",
        default="127.0.0.1,::1",
        help="Comma separated source IP allowlist",
    )
    parser.add_argument(
        "--mode",
        choices=["sniff", "simulate"],
        default="sniff",
        help="Use real packet sniffing or synthetic simulation mode",
    )
    return parser.parse_args()


def _post_security_signal(
    session: requests.Session,
    *,
    api_base_url: str,
    timeout_seconds: float,
    packet_rate: float,
    burst_ratio: float,
    unauthorized_attempts: int,
    security_flag: bool,
    sample_window_seconds: float,
) -> None:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "packet_rate": round(packet_rate, 3),
        "burst_ratio": round(burst_ratio, 3),
        "unauthorized_attempts": int(unauthorized_attempts),
        "security_flag": bool(security_flag),
        "source": "network-monitor",
        "sample_window_seconds": sample_window_seconds,
    }

    response = session.post(
        f"{api_base_url.rstrip('/')}/signals/security",
        json=payload,
        timeout=timeout_seconds,
    )
    response.raise_for_status()


def _iter_packets(interface: str, window_seconds: float) -> list:
    sniff_kwargs = {
        "timeout": max(window_seconds, 0.2),
        "store": True,
    }
    if interface:
        sniff_kwargs["iface"] = interface

    try:
        return sniff(**sniff_kwargs)
    except PermissionError as error:
        raise PermissionError(
            "Packet capture requires elevated privileges/Npcap. "
            "Run with --mode simulate if capture is unavailable."
        ) from error


def _extract_protocol_packets(packets: Iterable) -> tuple[int, int]:
    total = 0
    burst_like = 0

    for packet in packets:
        if TCP not in packet:
            continue

        destination_port = int(packet[TCP].dport)
        source_port = int(packet[TCP].sport)

        if destination_port in DEFAULT_PROTOCOL_PORTS or source_port in DEFAULT_PROTOCOL_PORTS:
            total += 1
            if destination_port in (502, 1883):
                burst_like += 1

    return total, burst_like


def _count_unauthorized_sources(packets: Iterable, allowed_sources: set[str]) -> int:
    attempts = 0
    for packet in packets:
        if IP not in packet or TCP not in packet:
            continue
        if int(packet[TCP].dport) not in DEFAULT_PROTOCOL_PORTS:
            continue
        source_ip = str(packet[IP].src)
        if source_ip not in allowed_sources:
            attempts += 1
    return attempts


def _compute_window_stats(
    packet_count: int,
    burst_count: int,
    unauthorized_attempts: int,
    window_seconds: float,
    expected_rate: float,
    burst_threshold: float,
    unauthorized_threshold: int,
    history: deque[float],
) -> WindowStats:
    packet_rate = packet_count / max(window_seconds, 1e-3)
    burst_ratio = burst_count / max(packet_count, 1)

    history.append(packet_rate)
    rolling_average = sum(history) / len(history)

    rate_deviation = abs(packet_rate - expected_rate)
    dynamic_burst = packet_rate > max(expected_rate * 1.6, rolling_average * 1.8)

    security_flag = (
        rate_deviation > max(expected_rate * 0.35, 25)
        or burst_ratio >= burst_threshold
        or unauthorized_attempts > unauthorized_threshold
        or dynamic_burst
    )

    return WindowStats(
        packet_rate=packet_rate,
        burst_ratio=burst_ratio,
        unauthorized_attempts=unauthorized_attempts,
        security_flag=security_flag,
    )


def _simulate_window(sample_index: int, expected_rate: float) -> tuple[int, int, int]:
    attack_window = sample_index % 17 == 0
    if attack_window:
        packet_count = int(expected_rate * 2.2)
        burst_count = int(packet_count * 0.9)
        unauthorized_attempts = random.randint(1, 3)
    else:
        packet_count = int(expected_rate + random.uniform(-15, 15))
        packet_count = max(packet_count, 0)
        burst_count = int(packet_count * random.uniform(0.08, 0.35))
        unauthorized_attempts = 0
    return packet_count, burst_count, unauthorized_attempts


def main() -> None:
    args = parse_args()

    allowed_sources = {
        value.strip() for value in args.allowed_source_ips.split(",") if value.strip()
    }
    history: deque[float] = deque(maxlen=max(args.history_windows, 5))

    sample_index = 0
    with requests.Session() as session:
        while True:
            sample_index += 1

            if args.mode == "simulate":
                packet_count, burst_count, unauthorized_attempts = _simulate_window(
                    sample_index,
                    args.expected_rate,
                )
                time.sleep(max(args.window_seconds, 0.1))
            else:
                packets = _iter_packets(args.interface, args.window_seconds)
                packet_count, burst_count = _extract_protocol_packets(packets)
                unauthorized_attempts = _count_unauthorized_sources(packets, allowed_sources)

            stats = _compute_window_stats(
                packet_count=packet_count,
                burst_count=burst_count,
                unauthorized_attempts=unauthorized_attempts,
                window_seconds=args.window_seconds,
                expected_rate=args.expected_rate,
                burst_threshold=args.burst_threshold,
                unauthorized_threshold=args.unauthorized_threshold,
                history=history,
            )

            _post_security_signal(
                session,
                api_base_url=args.api_base_url,
                timeout_seconds=args.timeout_seconds,
                packet_rate=stats.packet_rate,
                burst_ratio=stats.burst_ratio,
                unauthorized_attempts=stats.unauthorized_attempts,
                security_flag=stats.security_flag,
                sample_window_seconds=args.window_seconds,
            )

            print(
                f"[{sample_index}] rate={stats.packet_rate:.2f} pkt/s | "
                f"burst={stats.burst_ratio:.2f} | unauthorized={stats.unauthorized_attempts} | "
                f"security_flag={stats.security_flag}"
            )

            if args.max_samples > 0 and sample_index >= args.max_samples:
                break

            if not args.loop and args.max_samples <= 0:
                break


if __name__ == "__main__":
    main()
